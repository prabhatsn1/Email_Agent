'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Email {
  _id: string;
  from: string;
  subject: string;
  body: string;
  receivedAt: string;
  category: string;
  status: string;
  provider?: 'gmail' | 'outlook';
  followUpDate?: string;
  escalationReason?: string;
  draft?: {
    subject: string;
    body: string;
    confidence: number;
  } | null;
}

interface AgentAction {
  _id: string;
  emailId: {
    _id: string;
    from: string;
    subject: string;
    category: string;
    status: string;
  } | string;
  actionType: string;
  reasoning: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

interface Memory {
  _id: string;
  key: string;
  value: string;
  updatedAt: string;
}

interface EmailAccount {
  _id: string;
  provider: 'gmail' | 'outlook';
  email: string;
  name?: string;
  lastSyncAt?: string;
  expiresAt: string;
}

interface AgentRunResult {
  processed: number;
  actions: Array<{ emailId: string; action: string; reasoning: string }>;
  errors: string[];
  duration: number;
}

type ConnStatus = 'checking' | 'ok' | 'error';

interface HealthState {
  db: ConnStatus;
  ai: ConnStatus;
  dbLatency?: number;
  aiLatency?: number;
  dbError?: string;
  aiError?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const CATEGORY_STYLES: Record<string, { bg: string; text: string; dot: string }> = {
  CRITICAL:      { bg: 'bg-red-50',    text: 'text-red-700',    dot: 'bg-red-500'    },
  IMPORTANT:     { bg: 'bg-amber-50',  text: 'text-amber-700',  dot: 'bg-amber-500'  },
  INFORMATIONAL: { bg: 'bg-blue-50',   text: 'text-blue-700',   dot: 'bg-blue-500'   },
  NOISE:         { bg: 'bg-gray-50',   text: 'text-gray-500',   dot: 'bg-gray-400'   },
  UNCLASSIFIED:  { bg: 'bg-gray-50',   text: 'text-gray-400',   dot: 'bg-gray-300'   },
};

const STATUS_STYLES: Record<string, string> = {
  UNPROCESSED:        'text-gray-500',
  PROCESSING:         'text-blue-600',
  IGNORED:            'text-gray-400',
  DRAFT_CREATED:      'text-green-600',
  FOLLOW_UP_SCHEDULED:'text-amber-600',
  ESCALATED:          'text-red-600',
  DONE:               'text-green-700',
};

const ACTION_ICONS: Record<string, string> = {
  classify:            '🏷',
  draft_reply:         '✍️',
  schedule_follow_up:  '📅',
  escalate:            '🚨',
  ignore:              '🙈',
  store_memory:        '🧠',
};

function fmt(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function CategoryBadge({ cat }: { cat: string }) {
  const s = CATEGORY_STYLES[cat] ?? CATEGORY_STYLES.UNCLASSIFIED;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${s.bg} ${s.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {cat}
    </span>
  );
}

// ─── Connection indicator ─────────────────────────────────────────────────────

function ConnectionIndicator({ health }: { health: HealthState }) {
  const items: Array<{
    label: string;
    status: ConnStatus;
    latency?: number;
    error?: string;
  }> = [
    { label: 'MongoDB', status: health.db, latency: health.dbLatency, error: health.dbError },
    { label: 'Groq AI', status: health.ai, latency: health.aiLatency, error: health.aiError },
  ];

  return (
    <div className="flex items-center gap-3">
      {items.map(({ label, status, latency, error }) => {
        const dot =
          status === 'checking'
            ? 'bg-gray-300 animate-pulse'
            : status === 'ok'
            ? 'bg-green-400'
            : 'bg-red-500';
        const text =
          status === 'checking'
            ? 'text-gray-400'
            : status === 'ok'
            ? 'text-gray-500'
            : 'text-red-500';
        const title =
          status === 'ok'
            ? `${label} connected${latency !== undefined ? ` · ${latency}ms` : ''}`
            : status === 'error'
            ? `${label} error: ${error}`
            : `Checking ${label}…`;

        return (
          <div key={label} className="flex items-center gap-1.5" title={title}>
            <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
            <span className={`text-xs font-medium ${text} hidden sm:inline`}>{label}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Seed emails modal ────────────────────────────────────────────────────────

const SAMPLE_EMAILS = [
  {
    from: 'cto@yourcompany.com',
    subject: 'URGENT: Production database is down — all hands',
    body: 'The production DB has been unreachable for 10 minutes. We need an incident commander on a call NOW. Revenue impact is ~$5k/min. Join https://meet.company.com/incident-bridge immediately.',
    receivedAt: new Date().toISOString(),
  },
  {
    from: 'boss@yourcompany.com',
    subject: 'Q4 roadmap review — need your input by Friday',
    body: "Hi team, we're finalising the Q4 roadmap. Please review the draft at the link below and leave your comments by EOD Friday. Your section covers auth and billing. Thanks.",
    receivedAt: new Date(Date.now() - 3_600_000).toISOString(),
  },
  {
    from: 'client@bigcorp.com',
    subject: 'API integration question',
    body: "Hey, we're integrating your REST API and running into a 401 on the /webhooks endpoint. We've double-checked the token. Can you take a look? Happy to jump on a quick call.",
    receivedAt: new Date(Date.now() - 7_200_000).toISOString(),
  },
  {
    from: 'newsletter@techdigest.io',
    subject: 'TechDigest Weekly: Top 10 AI stories of the week',
    body: 'This week in AI: GPT-5 rumours, open-source breakthroughs, and why your prompt engineering might be holding you back. Read the full digest here.',
    receivedAt: new Date(Date.now() - 86_400_000).toISOString(),
  },
  {
    from: 'noreply@github.com',
    subject: '[email-agent] Dependabot: bump next from 16.1 to 16.2.6',
    body: 'Dependabot has opened pull request #42 to bump next from 16.1.0 to 16.2.6 in your repository. This update includes security patches.',
    receivedAt: new Date(Date.now() - 43_200_000).toISOString(),
  },
  {
    from: 'promo@shopify.com',
    subject: '🛒 Flash Sale: 30% off all plans — today only!',
    body: "Don't miss our biggest sale of the year! Get 30% off any Shopify plan when you upgrade today. Use code FLASH30 at checkout.",
    receivedAt: new Date(Date.now() - 172_800_000).toISOString(),
  },
];

function SeedModal({ onClose, onSeeded }: { onClose: () => void; onSeeded: () => void }) {
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(0);

  async function seed() {
    setLoading(true);
    for (let i = 0; i < SAMPLE_EMAILS.length; i++) {
      await fetch('/api/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(SAMPLE_EMAILS[i]),
      });
      setDone(i + 1);
    }
    setLoading(false);
    onSeeded();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md mx-4">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Seed sample emails</h2>
        <p className="text-sm text-gray-500 mb-4">
          This will insert {SAMPLE_EMAILS.length} representative emails (CRITICAL outage, manager request,
          client question, newsletter, Dependabot, promo) so you can watch the agent work.
        </p>
        {loading && (
          <div className="mb-4">
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>Inserting…</span>
              <span>{done}/{SAMPLE_EMAILS.length}</span>
            </div>
            <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
              <div
                className="h-full bg-indigo-500 transition-all"
                style={{ width: `${(done / SAMPLE_EMAILS.length) * 100}%` }}
              />
            </div>
          </div>
        )}
        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={seed}
            disabled={loading}
            className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40"
          >
            {loading ? 'Seeding…' : 'Seed emails'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Compose modal ────────────────────────────────────────────────────────────

function ComposeModal({ onClose, onSent }: { onClose: () => void; onSent: () => void }) {
  const [form, setForm] = useState({ from: '', subject: '', body: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.from || !form.subject || !form.body) {
      setError('All fields are required');
      return;
    }
    setLoading(true);
    setError('');
    const res = await fetch('/api/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, receivedAt: new Date().toISOString() }),
    });
    setLoading(false);
    if (res.ok) {
      onSent();
    } else {
      setError('Failed to create email');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-lg mx-4">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Ingest email</h2>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">From</label>
            <input
              value={form.from}
              onChange={(e) => setForm((f) => ({ ...f, from: e.target.value }))}
              placeholder="sender@example.com"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Subject</label>
            <input
              value={form.subject}
              onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
              placeholder="Subject line"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Body</label>
            <textarea
              value={form.body}
              onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
              rows={5}
              placeholder="Email body…"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-400 resize-none"
            />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2 justify-end pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40"
            >
              {loading ? 'Saving…' : 'Ingest email'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Email detail panel ───────────────────────────────────────────────────────

function EmailPanel({
  email,
  actions,
  onClose,
}: {
  email: Email;
  actions: AgentAction[];
  onClose: () => void;
}) {
  const emailActions = actions.filter((a) => {
    const id = typeof a.emailId === 'string' ? a.emailId : a.emailId?._id;
    return id === email._id;
  });

  return (
    <div className="fixed inset-y-0 right-0 z-40 w-full max-w-xl bg-white shadow-2xl flex flex-col">
      <div className="flex items-center justify-between p-4 border-b border-gray-100">
        <div className="min-w-0">
          <p className="text-xs text-gray-400 truncate">{email.from}</p>
          <h2 className="font-semibold text-gray-900 truncate">{email.subject}</h2>
        </div>
        <button
          onClick={onClose}
          className="ml-4 p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Meta */}
        <div className="flex flex-wrap gap-2">
          <CategoryBadge cat={email.category} />
          <span className={`text-xs font-medium ${STATUS_STYLES[email.status] ?? 'text-gray-500'}`}>
            {email.status.replace(/_/g, ' ')}
          </span>
          <span className="text-xs text-gray-400">{fmt(email.receivedAt)}</span>
        </div>

        {email.escalationReason && (
          <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
            <p className="font-medium mb-0.5">Escalated</p>
            <p>{email.escalationReason}</p>
          </div>
        )}

        {email.followUpDate && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-700">
            <p className="font-medium mb-0.5">Follow-up scheduled</p>
            <p>{fmt(email.followUpDate)}</p>
          </div>
        )}

        {/* Body */}
        <div>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Body</p>
          <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{email.body}</p>
        </div>

        {/* Draft */}
        {email.draft && (
          <div className="rounded-lg border border-green-200 bg-green-50 p-3">
            <p className="text-xs font-medium text-green-700 uppercase tracking-wide mb-2">
              Draft reply · {Math.round(email.draft.confidence * 100)}% confidence
            </p>
            <p className="text-xs font-semibold text-gray-700 mb-1">{email.draft.subject}</p>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{email.draft.body}</p>
          </div>
        )}

        {/* Agent actions */}
        {emailActions.length > 0 && (
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
              Agent actions
            </p>
            <div className="space-y-2">
              {emailActions.map((a) => (
                <div key={a._id} className="flex gap-2 text-sm">
                  <span className="mt-0.5">{ACTION_ICONS[a.actionType] ?? '•'}</span>
                  <div>
                    <span className="font-medium text-gray-700 capitalize">
                      {a.actionType.replace(/_/g, ' ')}
                    </span>
                    <p className="text-gray-500 text-xs mt-0.5">{a.reasoning}</p>
                    <p className="text-gray-400 text-xs">{fmt(a.timestamp)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Accounts tab ────────────────────────────────────────────────────────────

const PROVIDER_STYLES = {
  gmail:   { bg: 'bg-red-50',  text: 'text-red-700',  label: 'Gmail',   icon: '✉️' },
  outlook: { bg: 'bg-blue-50', text: 'text-blue-700', label: 'Outlook', icon: '📧' },
};

function AccountsTab({
  accounts,
  onDisconnect,
  onSync,
  syncing,
  syncResult,
}: {
  accounts: EmailAccount[];
  onDisconnect: (id: string) => void;
  onSync: () => void;
  syncing: boolean;
  syncResult: string | null;
}) {
  return (
    <div className="space-y-5">
      {/* Connect new account */}
      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <h3 className="font-semibold text-gray-900 mb-1">Connect an email account</h3>
        <p className="text-sm text-gray-500 mb-4">
          Authorize read-only access so the agent can fetch and triage your real inbox.
        </p>
        <div className="flex flex-wrap gap-3">
          <a
            href="/api/connect/gmail"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 bg-white hover:bg-red-50 hover:border-red-200 text-sm font-medium text-gray-700 transition-colors"
          >
            <span>✉️</span> Connect Gmail
          </a>
          <a
            href="/api/connect/outlook"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 bg-white hover:bg-blue-50 hover:border-blue-200 text-sm font-medium text-gray-700 transition-colors"
          >
            <span>📧</span> Connect Outlook
          </a>
        </div>

        {/* Setup note */}
        <div className="mt-4 rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800 space-y-1">
          <p className="font-semibold">Before connecting:</p>
          <p>
            <strong>Gmail:</strong> Add <code className="bg-amber-100 px-1 rounded">GOOGLE_CLIENT_ID</code> +{' '}
            <code className="bg-amber-100 px-1 rounded">GOOGLE_CLIENT_SECRET</code> to{' '}
            <code className="bg-amber-100 px-1 rounded">.env.local</code>. Create credentials at{' '}
            <em>console.cloud.google.com → APIs & Services → Credentials → OAuth 2.0</em>. Enable the Gmail API. Add redirect URI:{' '}
            <code className="bg-amber-100 px-1 rounded">http://localhost:3000/api/connect/gmail/callback</code>.
          </p>
          <p>
            <strong>Outlook:</strong> Add <code className="bg-amber-100 px-1 rounded">MICROSOFT_CLIENT_ID</code> +{' '}
            <code className="bg-amber-100 px-1 rounded">MICROSOFT_CLIENT_SECRET</code>. Register at{' '}
            <em>portal.azure.com → App registrations</em>. Permissions: <code className="bg-amber-100 px-1 rounded">Mail.Read</code>,{' '}
            <code className="bg-amber-100 px-1 rounded">User.Read</code>, <code className="bg-amber-100 px-1 rounded">offline_access</code>. Add redirect URI:{' '}
            <code className="bg-amber-100 px-1 rounded">http://localhost:3000/api/connect/outlook/callback</code>.
          </p>
        </div>
      </div>

      {/* Connected accounts */}
      {accounts.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-gray-700">Connected accounts</p>
            <button
              onClick={onSync}
              disabled={syncing}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {syncing && (
                <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
              )}
              {syncing ? 'Syncing…' : '↓ Sync all now'}
            </button>
          </div>

          {syncResult && (
            <div className="mb-3 rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-xs text-green-700">
              {syncResult}
            </div>
          )}

          <div className="space-y-2">
            {accounts.map((account) => {
              const style = PROVIDER_STYLES[account.provider];
              return (
                <div
                  key={account._id}
                  className="bg-white rounded-xl border border-gray-100 px-4 py-3 flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${style.bg} ${style.text}`}
                    >
                      {style.icon} {style.label}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">
                        {account.name ?? account.email}
                      </p>
                      <p className="text-xs text-gray-400 truncate">{account.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <p className="text-xs text-gray-400 hidden sm:block">
                      {account.lastSyncAt
                        ? `Synced ${fmt(account.lastSyncAt)}`
                        : 'Never synced'}
                    </p>
                    <button
                      onClick={() => onDisconnect(account._id)}
                      className="text-xs text-red-500 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50"
                    >
                      Disconnect
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {accounts.length === 0 && (
        <div className="text-center py-8 text-gray-400">
          <p className="font-medium text-gray-600">No accounts connected yet</p>
          <p className="text-sm mt-1">Connect Gmail or Outlook above to get started.</p>
        </div>
      )}
    </div>
  );
}

// ─── Stats bar ────────────────────────────────────────────────────────────────

function StatsBar({ emails }: { emails: Email[] }) {
  const counts = {
    total: emails.length,
    critical: emails.filter((e) => e.category === 'CRITICAL').length,
    escalated: emails.filter((e) => e.status === 'ESCALATED').length,
    drafts: emails.filter((e) => e.draft).length,
    followUps: emails.filter((e) => e.status === 'FOLLOW_UP_SCHEDULED').length,
    unprocessed: emails.filter((e) => e.status === 'UNPROCESSED').length,
  };

  const stats = [
    { label: 'Total', value: counts.total, color: 'text-gray-900' },
    { label: 'Unprocessed', value: counts.unprocessed, color: 'text-gray-500' },
    { label: 'Critical', value: counts.critical, color: 'text-red-600' },
    { label: 'Escalated', value: counts.escalated, color: 'text-red-600' },
    { label: 'Drafts ready', value: counts.drafts, color: 'text-green-600' },
    { label: 'Follow-ups', value: counts.followUps, color: 'text-amber-600' },
  ];

  return (
    <div className="grid grid-cols-3 sm:grid-cols-6 gap-px bg-gray-100 rounded-xl overflow-hidden border border-gray-100">
      {stats.map((s) => (
        <div key={s.label} className="bg-white px-3 py-3 text-center">
          <p className={`text-2xl font-bold tabular-nums ${s.color}`}>{s.value}</p>
          <p className="text-xs text-gray-400 mt-0.5">{s.label}</p>
        </div>
      ))}
    </div>
  );
}

// ─── Main dashboard ───────────────────────────────────────────────────────────

type Tab = 'inbox' | 'escalations' | 'drafts' | 'decisions' | 'memory' | 'accounts';

export default function DashboardPage() {
  return (
    <Suspense>
      <Dashboard />
    </Suspense>
  );
}

function Dashboard() {
  const searchParams = useSearchParams();
  const [emails, setEmails] = useState<Email[]>([]);
  const [actions, setActions] = useState<AgentAction[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [agentRunning, setAgentRunning] = useState(false);
  const [agentResult, setAgentResult] = useState<AgentRunResult | null>(null);
  const [tab, setTab] = useState<Tab>('inbox');
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
  const [showSeed, setShowSeed] = useState(false);
  const [showCompose, setShowCompose] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [health, setHealth] = useState<HealthState>({ db: 'checking', ai: 'checking' });
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [oauthBanner, setOauthBanner] = useState<string | null>(null);

  const checkHealth = useCallback(async () => {
    setHealth((h) => ({ ...h, db: h.db === 'checking' ? 'checking' : h.db, ai: h.ai === 'checking' ? 'checking' : h.ai }));
    try {
      const res = await fetch('/api/health');
      const data = (await res.json()) as {
        db: { ok: boolean; latencyMs?: number; error?: string };
        ai: { ok: boolean; latencyMs?: number; error?: string };
      };
      setHealth({
        db: data.db.ok ? 'ok' : 'error',
        ai: data.ai.ok ? 'ok' : 'error',
        dbLatency: data.db.latencyMs,
        aiLatency: data.ai.latencyMs,
        dbError: data.db.error,
        aiError: data.ai.error,
      });
    } catch {
      setHealth({ db: 'error', ai: 'error', dbError: 'Unreachable', aiError: 'Unreachable' });
    }
  }, []);

  const fetchData = useCallback(async () => {
    const [emailRes, actionRes, accountRes] = await Promise.all([
      fetch('/api/emails?limit=200'),
      fetch('/api/actions?limit=500'),
      fetch('/api/connect/accounts'),
    ]);
    const [emailData, actionData, accountData] = await Promise.all([
      emailRes.json(), actionRes.json(), accountRes.json(),
    ]);
    if (emailData.ok) setEmails(emailData.data);
    if (actionData.ok) {
      setActions(actionData.data);
      setMemories(actionData.memories ?? []);
    }
    if (accountData.ok) setAccounts(accountData.data);
    setLoading(false);
  }, []);

  // Handle OAuth redirect params (connected=gmail|outlook or error=...)
  useEffect(() => {
    const connected = searchParams.get('connected');
    const error = searchParams.get('error');
    if (connected) {
      setOauthBanner(`✓ ${connected === 'gmail' ? 'Gmail' : 'Outlook'} connected successfully`);
      setTab('accounts');
      window.history.replaceState({}, '', '/dashboard');
    } else if (error) {
      setOauthBanner(`OAuth error: ${decodeURIComponent(error)}`);
      window.history.replaceState({}, '', '/dashboard');
    }
  }, [searchParams]);

  useEffect(() => {
    fetchData();
    checkHealth();
  }, [fetchData, checkHealth]);

  async function runAgent() {
    setAgentRunning(true);
    setAgentResult(null);
    try {
      const res = await fetch('/api/agent', { method: 'POST' });
      const data = (await res.json()) as { ok: boolean; result: AgentRunResult };
      if (data.ok) setAgentResult(data.result);
    } catch {
      // surface in UI via agentResult being null
    }
    setAgentRunning(false);
    await fetchData();
  }

  async function syncEmails() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch('/api/sync', { method: 'POST' });
      const data = (await res.json()) as { ok: boolean; totalSynced: number; errors: string[] };
      if (data.ok) {
        setSyncResult(
          `Synced ${data.totalSynced} new email${data.totalSynced !== 1 ? 's' : ''}${data.errors.length ? ` · ${data.errors.length} error(s)` : ''}`
        );
        await fetchData();
      }
    } catch {
      setSyncResult('Sync failed');
    }
    setSyncing(false);
  }

  async function disconnectAccount(id: string) {
    await fetch(`/api/connect/accounts?id=${id}`, { method: 'DELETE' });
    await fetchData();
  }

  const filteredEmails = emails.filter((e) => {
    if (tab === 'escalations') return e.status === 'ESCALATED';
    if (tab === 'drafts') return e.draft != null;
    if (tab === 'inbox') {
      if (categoryFilter !== 'ALL') return e.category === categoryFilter;
      return true;
    }
    return true;
  });

  const TABS: { key: Tab; label: string; count?: number }[] = [
    { key: 'inbox', label: 'Inbox', count: emails.length },
    { key: 'escalations', label: 'Escalations', count: emails.filter((e) => e.status === 'ESCALATED').length },
    { key: 'drafts', label: 'Drafts', count: emails.filter((e) => e.draft).length },
    { key: 'decisions', label: 'Decisions', count: actions.length },
    { key: 'memory', label: 'Memory', count: memories.length },
    { key: 'accounts', label: 'Accounts', count: accounts.length },
  ];

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center">
              <span className="text-white text-xs font-bold">AI</span>
            </div>
            <h1 className="font-semibold text-gray-900">Email Triage Agent</h1>
          </div>
          <ConnectionIndicator health={health} />
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSeed(true)}
              className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 hover:bg-gray-50"
            >
              Seed emails
            </button>
            <button
              onClick={() => setShowCompose(true)}
              className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 hover:bg-gray-50"
            >
              + Ingest email
            </button>
            <button
              onClick={runAgent}
              disabled={agentRunning}
              className="px-4 py-1.5 text-xs rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              {agentRunning && (
                <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
              )}
              {agentRunning ? 'Running…' : 'Run agent'}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-5">
        {/* Agent result banner */}
        {agentResult && (
          <div className="rounded-xl bg-indigo-50 border border-indigo-200 p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-medium text-indigo-900">Agent run complete</p>
                <p className="text-sm text-indigo-700 mt-0.5">
                  Processed {agentResult.processed} emails · {agentResult.actions.length} actions taken ·{' '}
                  {agentResult.duration}ms
                </p>
                {agentResult.errors.length > 0 && (
                  <p className="text-xs text-red-600 mt-1">
                    Errors: {agentResult.errors.join(', ')}
                  </p>
                )}
              </div>
              <button
                onClick={() => setAgentResult(null)}
                className="text-indigo-400 hover:text-indigo-600 text-xs"
              >
                dismiss
              </button>
            </div>
          </div>
        )}

        {/* Stats */}
        <StatsBar emails={emails} />

        {/* Tabs */}
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                tab === t.key
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.label}
              {t.count !== undefined && t.count > 0 && (
                <span className={`ml-1.5 text-xs ${tab === t.key ? 'text-indigo-600' : 'text-gray-400'}`}>
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Category filter (inbox only) */}
        {tab === 'inbox' && (
          <div className="flex gap-1.5 flex-wrap">
            {['ALL', 'CRITICAL', 'IMPORTANT', 'INFORMATIONAL', 'NOISE', 'UNCLASSIFIED'].map((cat) => (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat)}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                  categoryFilter === cat
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        )}

        {/* OAuth banner */}
        {oauthBanner && (
          <div className={`rounded-xl border px-4 py-3 text-sm flex items-center justify-between ${oauthBanner.startsWith('✓') ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
            <span>{oauthBanner}</span>
            <button onClick={() => setOauthBanner(null)} className="text-xs opacity-60 hover:opacity-100">dismiss</button>
          </div>
        )}

        {/* Content */}
        {loading ? (
          <div className="text-center py-16 text-gray-400">Loading…</div>
        ) : tab === 'accounts' ? (
          <AccountsTab
            accounts={accounts}
            onDisconnect={disconnectAccount}
            onSync={syncEmails}
            syncing={syncing}
            syncResult={syncResult}
          />
        ) : tab === 'decisions' ? (
          <DecisionsTab actions={actions} />
        ) : tab === 'memory' ? (
          <MemoryTab memories={memories} />
        ) : filteredEmails.length === 0 ? (
          <EmptyState tab={tab} />
        ) : (
          <div className="space-y-1.5">
            {filteredEmails.map((email) => (
              <EmailRow
                key={email._id}
                email={email}
                onClick={() => setSelectedEmail(email)}
                selected={selectedEmail?._id === email._id}
              />
            ))}
          </div>
        )}
      </main>

      {/* Modals & panels */}
      {showSeed && (
        <SeedModal
          onClose={() => setShowSeed(false)}
          onSeeded={() => { setShowSeed(false); fetchData(); }}
        />
      )}
      {showCompose && (
        <ComposeModal
          onClose={() => setShowCompose(false)}
          onSent={() => { setShowCompose(false); fetchData(); }}
        />
      )}
      {selectedEmail && (
        <>
          <div
            className="fixed inset-0 z-30 bg-black/10"
            onClick={() => setSelectedEmail(null)}
          />
          <EmailPanel
            email={selectedEmail}
            actions={actions}
            onClose={() => setSelectedEmail(null)}
          />
        </>
      )}
    </div>
  );
}

// ─── Email row ────────────────────────────────────────────────────────────────

function EmailRow({
  email,
  onClick,
  selected,
}: {
  email: Email;
  onClick: () => void;
  selected: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-xl border px-4 py-3 flex items-start gap-3 hover:border-indigo-200 hover:bg-indigo-50/30 transition-colors ${
        selected ? 'border-indigo-300 bg-indigo-50' : 'border-gray-100 bg-white'
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gray-400 truncate max-w-[160px]">{email.from}</span>
          <CategoryBadge cat={email.category} />
          {email.provider && (
            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${email.provider === 'gmail' ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'}`}>
              {email.provider === 'gmail' ? 'Gmail' : 'Outlook'}
            </span>
          )}
          {email.status === 'ESCALATED' && (
            <span className="text-xs font-semibold text-red-600">🚨 Escalated</span>
          )}
          {email.draft && (
            <span className="text-xs font-medium text-green-600">✍️ Draft ready</span>
          )}
          {email.status === 'FOLLOW_UP_SCHEDULED' && (
            <span className="text-xs font-medium text-amber-600">📅 Follow-up</span>
          )}
        </div>
        <p className="font-medium text-sm text-gray-800 mt-0.5 truncate">{email.subject}</p>
        <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{email.body}</p>
      </div>
      <span className="text-xs text-gray-400 whitespace-nowrap mt-0.5 shrink-0">
        {fmt(email.receivedAt)}
      </span>
    </button>
  );
}

// ─── Decisions tab ────────────────────────────────────────────────────────────

function DecisionsTab({ actions }: { actions: AgentAction[] }) {
  if (actions.length === 0) return <EmptyState tab="decisions" />;
  return (
    <div className="space-y-1.5">
      {actions.map((a) => {
        const emailRef = typeof a.emailId === 'object' ? a.emailId : null;
        return (
          <div
            key={a._id}
            className="bg-white rounded-xl border border-gray-100 px-4 py-3 flex items-start gap-3"
          >
            <span className="text-lg">{ACTION_ICONS[a.actionType] ?? '•'}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-gray-800 capitalize">
                  {a.actionType.replace(/_/g, ' ')}
                </span>
                {emailRef && <CategoryBadge cat={emailRef.category} />}
              </div>
              {emailRef && (
                <p className="text-xs text-gray-500 truncate mt-0.5">
                  {emailRef.from} — {emailRef.subject}
                </p>
              )}
              <p className="text-xs text-gray-500 mt-1 italic">{a.reasoning}</p>
            </div>
            <span className="text-xs text-gray-400 whitespace-nowrap shrink-0">{fmt(a.timestamp)}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Memory tab ───────────────────────────────────────────────────────────────

function MemoryTab({ memories }: { memories: Memory[] }) {
  if (memories.length === 0) return <EmptyState tab="memory" />;
  return (
    <div className="space-y-1.5">
      {memories.map((m) => (
        <div
          key={m._id}
          className="bg-white rounded-xl border border-gray-100 px-4 py-3"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-mono text-indigo-600 font-semibold truncate">{m.key}</p>
              <p className="text-sm text-gray-700 mt-0.5">{m.value}</p>
            </div>
            <span className="text-xs text-gray-400 whitespace-nowrap shrink-0">{fmt(m.updatedAt)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

const EMPTY_COPY: Record<string, { title: string; body: string }> = {
  inbox:       { title: 'Inbox is empty', body: 'Seed some emails or ingest one manually, then run the agent.' },
  escalations: { title: 'No escalations', body: 'The agent has not escalated any emails yet.' },
  drafts:      { title: 'No drafts yet', body: 'Run the agent — it will draft replies for CRITICAL and IMPORTANT emails.' },
  decisions:   { title: 'No decisions yet', body: 'Run the agent to start processing emails.' },
  memory:      { title: 'Memory is empty', body: 'The agent stores patterns and preferences here after processing emails.' },
  accounts:    { title: 'No accounts', body: 'Connect Gmail or Outlook from the Accounts tab.' },
};

function EmptyState({ tab }: { tab: string }) {
  const copy = EMPTY_COPY[tab] ?? EMPTY_COPY.inbox;
  return (
    <div className="text-center py-16 text-gray-400">
      <p className="font-medium text-gray-600">{copy.title}</p>
      <p className="text-sm mt-1">{copy.body}</p>
    </div>
  );
}
