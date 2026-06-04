<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# Autonomous Email Triage Agent — Agent Guide

## Project overview

An agentic AI system that autonomously manages email overload. The LLM (Groq) drives an agentic loop using OpenAI-compatible function calling — it calls real tools that read/write MongoDB, not simulated actions.

**Stack:** Next.js 16 (App Router) · TypeScript (strict) · MongoDB + Mongoose · Groq SDK · Tailwind CSS v4

---

## Critical Next.js 16 rules

- Route handler files **must be `.ts`**, never `.tsx`
- `params` and `searchParams` in pages/layouts are **Promises** — always `await` them
- Route handler `params` context is also a Promise: `const { id } = await params`
- `cookies()` from `next/headers` is async — `await cookies()` or use `request.cookies.get()` instead
- Route handlers use **named exports** (`export async function GET(...)`) — no default exports
- A `route.ts` and a `page.tsx` cannot coexist at the same path segment

---

## Project structure

```
app/
  api/
    agent/route.ts          POST → triggers agent loop
    emails/route.ts         GET list / POST ingest
    actions/route.ts        GET agent action log + memories
    health/route.ts         GET connection status (MongoDB + Groq)
    sync/route.ts           POST → sync all connected email accounts
    connect/
      gmail/route.ts        GET → initiate Gmail OAuth
      gmail/callback/route.ts   GET → Gmail OAuth callback
      outlook/route.ts      GET → initiate Outlook OAuth
      outlook/callback/route.ts GET → Outlook OAuth callback
      accounts/route.ts     GET list / DELETE disconnect account
  dashboard/page.tsx        Main UI (Client Component, 'use client')
  layout.tsx
  page.tsx                  Redirects to /dashboard

lib/
  agent/
    agent.ts                Groq function-calling agentic loop
    prompt.ts               System prompt + tool definitions (JSON schema)
  db/
    mongo.ts                Singleton MongoDB connection (global cache)
    models/
      Email.ts              Email document + Mongoose model
      Draft.ts              Draft reply document
      Action.ts             Agent action log document
      Memory.ts             Agent memory (key/value)
      EmailAccount.ts       OAuth-connected account (Gmail/Outlook)
  sync/
    gmail.ts                Gmail API sync + token refresh
    outlook.ts              Microsoft Graph sync + token refresh
    syncService.ts          syncAllAccounts() orchestrator
  tools/
    emailTools.ts           Tool implementations + dispatchTool()

types/
  email.ts                  IEmail, IDraft, IAgentAction, IMemory, IEmailAccount
  agent.ts                  AgentRunResult, ToolCallResult, etc.
```

---

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `MONGODB_URI` | Yes | MongoDB connection string |
| `GROQ_API_KEY` | Yes | Groq AI API key |
| `GROQ_MODEL` | No | Defaults to `llama-3.3-70b-versatile` |
| `GOOGLE_CLIENT_ID` | For Gmail | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | For Gmail | Google OAuth client secret |
| `MICROSOFT_CLIENT_ID` | For Outlook | Azure app client ID |
| `MICROSOFT_CLIENT_SECRET` | For Outlook | Azure app client secret |

Copy `env.local.example` → `.env.local` and fill in values.

---

## MongoDB models

### Email
Fields: `from`, `subject`, `body`, `receivedAt`, `category`, `status`, `followUpDate`, `escalationReason`, `externalId` (Gmail/Outlook message ID), `provider` (`gmail`|`outlook`), `accountId` (ref EmailAccount)

Category enum: `CRITICAL | IMPORTANT | INFORMATIONAL | NOISE | UNCLASSIFIED`  
Status enum: `UNPROCESSED → PROCESSING → ESCALATED | DRAFT_CREATED | FOLLOW_UP_SCHEDULED | IGNORED | DONE`

Indexes: `{status, receivedAt}`, `{category}`, `{externalId, provider}` (sparse unique — prevents duplicate syncs)

### EmailAccount
Fields: `provider` (`gmail`|`outlook`), `email`, `name`, `accessToken`, `refreshToken`, `expiresAt`, `lastSyncAt`  
Unique index on `{provider, email}`

### Draft
Fields: `emailId` (ref Email), `subject`, `body`, `confidence` (0–1)

### Action
Fields: `emailId` (ref Email), `actionType` (`classify|draft_reply|schedule_follow_up|escalate|ignore|store_memory`), `reasoning`, `timestamp`, `metadata`

### Memory
Fields: `key` (unique), `value`, `updatedAt` — upserted on write

---

## API response format

All API routes return:
```json
{ "ok": true, "data": ... }
{ "ok": false, "error": "..." }
```
With appropriate HTTP status codes (400 for validation errors, 500 for server errors, 201 for creation).

---

## Agent loop (`lib/agent/agent.ts`)

1. Creates a Groq client using `GROQ_API_KEY`
2. Sends system prompt + "process all unprocessed emails" user message
3. LLM responds with `tool_calls` → loop executes each via `dispatchTool()`
4. Tool results fed back as `role: 'tool'` messages
5. Continues until `finish_reason === 'stop'` or no tool calls remain
6. Returns `{ processed, actions, errors, duration }`

The Groq SDK's `ChatCompletionMessageToolCall` has `.function` directly (not a union type like OpenAI v6).

---

## Agent tools (`lib/tools/emailTools.ts`)

Each tool: takes typed args → calls `connectDB()` → reads/writes MongoDB → returns `{ success, data?, error? }`.

| Tool | What it does |
|---|---|
| `readEmails()` | Fetches UNPROCESSED emails, limit 50 |
| `classifyEmail(id, category, reasoning, confidence)` | Sets category, status→PROCESSING, logs Action |
| `draftReply(id, subject, body, confidence, reasoning)` | Creates Draft doc, status→DRAFT_CREATED |
| `scheduleFollowUp(id, followUpDate, reasoning)` | Sets followUpDate, status→FOLLOW_UP_SCHEDULED |
| `escalateEmail(id, reason)` | Sets escalationReason, status→ESCALATED |
| `storeMemory(key, value, reasoning)` | Upserts Memory by key |
| `ignoreEmail(id, reasoning)` | Status→IGNORED (internal, not exposed as LLM tool) |

New tools must be added to both `emailTools.ts` (implementation) and `lib/agent/prompt.ts` (JSON schema definition).

---

## OAuth flow

**Initiate:** `GET /api/connect/gmail` or `/api/connect/outlook`
- Generates `crypto.randomUUID()` state → stores in httpOnly cookie `oauth_state` (10 min TTL)
- Redirects to provider's consent screen

**Callback:** `GET /api/connect/gmail/callback` or `/api/connect/outlook/callback`
- Verifies `state` param matches `oauth_state` cookie (CSRF protection)
- Exchanges `code` for tokens via provider's token endpoint
- Fetches user email (`/oauth2/v2/userinfo` for Google, `/me` for Microsoft Graph)
- Upserts `EmailAccount` in MongoDB
- Redirects to `/dashboard?connected=gmail` (or `?error=...`)

**Token refresh:** Both `lib/sync/gmail.ts` and `lib/sync/outlook.ts` call `ensureFreshToken()` before API calls. If `expiresAt` is within 60s, they POST to the token endpoint with `grant_type=refresh_token` and update the stored token.

---

## Email sync

`POST /api/sync` → `syncAllAccounts()` → per account:
- Gmail: `GET gmail.googleapis.com/gmail/v1/users/me/messages?q=is:unread&maxResults=50` → fetch each with `?format=full` → parse multipart body (base64url decoded)
- Outlook: `GET graph.microsoft.com/v1.0/me/messages?$filter=isRead eq false&$top=50` → strip HTML if `contentType=html`
- Both deduplicate by `{externalId, provider}` sparse unique index — safe to call repeatedly
- Updates `lastSyncAt` on account after sync

---

## Dashboard (`app/dashboard/page.tsx`)

Client Component (`'use client'`). Wrapped in `<Suspense>` to support `useSearchParams()`.

**Tabs:** Inbox · Escalations · Drafts · Decisions · Memory · Accounts  
**State fetched on mount:** `/api/emails`, `/api/actions`, `/api/connect/accounts`  
**Health check on mount:** `/api/health` — shows MongoDB + Groq connection dots in header

Key patterns:
- `fetchData()` is wrapped in `useCallback` with `[]` deps — refresh by calling it directly
- OAuth redirect params (`?connected=` / `?error=`) are read via `useSearchParams()`, shown as a banner, then cleared from URL with `window.history.replaceState`
- Accounts tab connects directly to `/api/connect/gmail` or `/api/connect/outlook` via plain `<a href>` (no client-side fetch — needs a full redirect)

---

## Conventions

- All Mongoose models follow the pattern: `interface XDocument extends Document { ... }` → `Schema` → `index()` → `mongoose.models.X ?? mongoose.model<XDocument>('X', Schema)`
- `connectDB()` must be called at the start of every tool function and API route that touches the DB
- Tokens are stored as plaintext in MongoDB — in production, encrypt at rest
- No new npm packages without good reason — prefer `fetch`, built-in `crypto`, and `Buffer`
- TypeScript strict mode — no `any`, no unchecked `!` without a guard
