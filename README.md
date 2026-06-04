# Autonomous Email Triage Agent

An agentic AI system built with Next.js 16, TypeScript, MongoDB, and an OpenAI-compatible LLM that autonomously manages email overload — classifying emails, drafting replies, scheduling follow-ups, and escalating critical items.

---

## Why this is agentic AI (not a chatbot)

Most "AI email tools" send one prompt and display the response. This system is different:

1. **The agent drives its own loop.** It calls `readEmails` → receives a list of emails → decides what to do with each → executes tools → loops until all emails are processed. No human prompt per email.

2. **Tool use, not hallucination.** Every action (classify, draft, escalate, schedule) is executed via a real function that writes to MongoDB. The LLM cannot hallucinate a draft — it must call `draftReply(emailId, subject, body, confidence)` and the system persists it.

3. **Persistent memory.** The agent calls `storeMemory(key, value)` to record learned patterns (e.g. "sender:boss@company.com → always CRITICAL"). Future runs use this context.

4. **Autonomous decision-making.** The agent decides which emails the user even needs to see. NOISE emails are silently ignored. INFORMATIONAL emails are acknowledged but not surfaced. Only CRITICAL and IMPORTANT emails get action.

5. **State machine per email.** Each email progresses through a real status machine: `UNPROCESSED → PROCESSING → ESCALATED | DRAFT_CREATED | FOLLOW_UP_SCHEDULED | IGNORED | DONE`.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Next.js App (Port 3000)                   │
│                                                             │
│  ┌──────────────┐    ┌─────────────────────────────────┐   │
│  │  Dashboard   │    │         API Layer                │   │
│  │  /dashboard  │    │  POST /api/agent  → agent loop   │   │
│  │              │    │  GET  /api/emails → list emails   │   │
│  │  • Inbox     │    │  POST /api/emails → ingest email  │   │
│  │  • Drafts    │    │  GET  /api/actions→ list actions  │   │
│  │  • Escalated │    └──────────────┬──────────────────┘   │
│  │  • Decisions │                   │                       │
│  │  • Memory    │    ┌──────────────▼──────────────────┐   │
│  └──────────────┘    │        Agent Brain               │   │
│                      │  lib/agent/agent.ts              │   │
│                      │                                  │   │
│                      │  1. Send system prompt + emails  │   │
│                      │  2. LLM calls tools via FC       │   │
│                      │  3. Execute tools (real DB ops)  │   │
│                      │  4. Feed results back to LLM     │   │
│                      │  5. Loop until no tool calls     │   │
│                      └──────────────┬──────────────────┘   │
│                                     │                       │
│                      ┌──────────────▼──────────────────┐   │
│                      │        Tool Layer                │   │
│                      │  lib/tools/emailTools.ts         │   │
│                      │                                  │   │
│                      │  readEmails()                    │   │
│                      │  classifyEmail()                 │   │
│                      │  draftReply()                    │   │
│                      │  scheduleFollowUp()              │   │
│                      │  escalateEmail()                 │   │
│                      │  storeMemory()                   │   │
│                      └──────────────┬──────────────────┘   │
│                                     │                       │
│                      ┌──────────────▼──────────────────┐   │
│                      │        MongoDB                   │   │
│                      │  Collections:                    │   │
│                      │  • emails                        │   │
│                      │  • drafts                        │   │
│                      │  • actions                       │   │
│                      │  • memories                      │   │
│                      └─────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## Project structure

```
email_agent/
├── app/
│   ├── api/
│   │   ├── agent/route.ts        # POST → triggers agent loop
│   │   ├── emails/route.ts       # GET list / POST ingest
│   │   └── actions/route.ts      # GET agent action log
│   ├── dashboard/page.tsx        # Main UI (Client Component)
│   ├── layout.tsx
│   └── page.tsx                  # Redirects to /dashboard
├── lib/
│   ├── agent/
│   │   ├── agent.ts              # Agent reasoning loop (OpenAI function calling)
│   │   └── prompt.ts             # System prompt + tool definitions
│   ├── db/
│   │   ├── mongo.ts              # Singleton MongoDB connection
│   │   └── models/
│   │       ├── Email.ts          # Email schema + model
│   │       ├── Draft.ts          # Draft schema + model
│   │       ├── Action.ts         # Agent action log schema + model
│   │       └── Memory.ts         # Agent memory schema + model
│   └── tools/
│       └── emailTools.ts         # Tool implementations + dispatcher
├── types/
│   ├── email.ts                  # Email, Draft, AgentAction, Memory types
│   └── agent.ts                  # Agent run types, tool call types
├── env.local.example             # Environment variable template
└── README.md
```

---

## How to run locally

### Prerequisites

- Node.js 18+
- MongoDB running locally (`mongod`) or a MongoDB Atlas connection string

### 1. Clone and install

```bash
git clone <repo-url>
cd email_agent
npm install
```

### 2. Configure environment

```bash
cp env.local.example .env.local
```

Edit `.env.local`:

```env
# Required
MONGODB_URI=mongodb://localhost:27017/email-agent
GROQ_API_KEY=gsk_...   # get free at https://console.groq.com

# Optional — default model is llama-3.3-70b-versatile
# GROQ_MODEL=llama-3.3-70b-versatile
```

**Available Groq models with tool-use support:**
- `llama-3.3-70b-versatile` (default — best quality)
- `llama3-groq-70b-8192-tool-use-preview`
- `llama3-groq-8b-8192-tool-use-preview` (faster, lower latency)

### 3. Start MongoDB (if running locally)

```bash
mongod --dbpath /data/db
```

### 4. Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — it redirects to `/dashboard`.

---

## Using the agent

### Step 1: Seed emails

Click **"Seed emails"** in the top-right to insert 6 sample emails spanning all categories:
- 🔴 CRITICAL: production outage call
- 🟡 IMPORTANT: Q4 roadmap review from boss
- 🟡 IMPORTANT: client API question
- 🔵 INFORMATIONAL: Dependabot PR
- ⚪ NOISE: tech newsletter
- ⚪ NOISE: promotional email

Or click **"+ Ingest email"** to add your own.

### Step 2: Run the agent

Click **"Run agent"** — the agent will:
1. Call `readEmails()` → fetch all UNPROCESSED emails
2. Call `classifyEmail()` for each → CRITICAL / IMPORTANT / INFORMATIONAL / NOISE
3. For CRITICAL emails → `escalateEmail()` + `draftReply()` + `scheduleFollowUp()`
4. For IMPORTANT emails → `draftReply()` + `scheduleFollowUp()` (if deadline implied)
5. For INFORMATIONAL / NOISE → mark as IGNORED
6. Call `storeMemory()` for any notable patterns

### Step 3: Review results

- **Inbox tab** — all emails with category badges and status indicators
- **Escalations tab** — emails the agent flagged as requiring immediate attention
- **Drafts tab** — AI-drafted replies with confidence scores
- **Decisions tab** — full audit log of every tool call + reasoning
- **Memory tab** — patterns and preferences the agent has stored

Click any email to see the full body, draft, escalation reason, and per-email action log in the side panel.

---

## API reference

### `POST /api/agent`

Triggers the agent loop.

```json
// Request body (all optional)
{
  "maxIterations": 50,
  "dryRun": false
}

// Response
{
  "ok": true,
  "result": {
    "processed": 6,
    "actions": [{ "emailId": "...", "action": "classify → CRITICAL", "reasoning": "..." }],
    "errors": [],
    "duration": 4821
  }
}
```

### `GET /api/emails`

Query params: `status`, `category`, `limit` (max 200), `page`

### `POST /api/emails`

Ingest an email:

```json
{
  "from": "sender@example.com",
  "subject": "Subject line",
  "body": "Email body text",
  "receivedAt": "2024-01-15T10:30:00Z"
}
```

### `GET /api/actions`

Query params: `emailId`, `actionType`, `limit` (max 500), `page`

Response includes `memories` array with all stored agent memory.

---

## MongoDB schemas

### `emails`
| Field | Type | Notes |
|-------|------|-------|
| `from` | String | Sender email |
| `subject` | String | Email subject |
| `body` | String | Full email body |
| `receivedAt` | Date | When email arrived |
| `category` | Enum | CRITICAL \| IMPORTANT \| INFORMATIONAL \| NOISE \| UNCLASSIFIED |
| `status` | Enum | UNPROCESSED → ESCALATED \| DRAFT_CREATED \| FOLLOW_UP_SCHEDULED \| IGNORED \| DONE |
| `followUpDate` | Date | Set by `scheduleFollowUp` |
| `escalationReason` | String | Set by `escalateEmail` |

### `drafts`
| Field | Type | Notes |
|-------|------|-------|
| `emailId` | ObjectId | Reference to `emails` |
| `subject` | String | Reply subject |
| `body` | String | Full reply body |
| `confidence` | Number | 0–1, LLM's self-reported confidence |

### `actions`
| Field | Type | Notes |
|-------|------|-------|
| `emailId` | ObjectId | Reference to `emails` |
| `actionType` | Enum | classify \| draft_reply \| schedule_follow_up \| escalate \| ignore \| store_memory |
| `reasoning` | String | LLM's explanation for the action |
| `timestamp` | Date | When the action was taken |
| `metadata` | Mixed | Additional action-specific data |

### `memories`
| Field | Type | Notes |
|-------|------|-------|
| `key` | String | Unique key (e.g. `sender:cto@company.com:priority`) |
| `value` | String | Stored learning or preference |
| `updatedAt` | Date | Last updated (upserted on write) |
