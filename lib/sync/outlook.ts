import { connectDB } from '@/lib/db/mongo';
import { EmailModel } from '@/lib/db/models/Email';
import { EmailAccountModel } from '@/lib/db/models/EmailAccount';
import type { EmailAccountDocument } from '@/lib/db/models/EmailAccount';

const GRAPH_API = 'https://graph.microsoft.com/v1.0';
const TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';

// ─── Token refresh ────────────────────────────────────────────────────────────

async function ensureFreshToken(account: EmailAccountDocument): Promise<string> {
  if (account.expiresAt > new Date(Date.now() + 60_000)) return account.accessToken;

  if (!account.refreshToken) throw new Error('No refresh token — user must re-authenticate');

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.MICROSOFT_CLIENT_ID!,
      client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
      refresh_token: account.refreshToken,
      grant_type: 'refresh_token',
      scope: 'https://graph.microsoft.com/Mail.Read offline_access',
    }),
  });

  const data = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !data.access_token) {
    throw new Error(`Outlook token refresh failed: ${data.error ?? res.status}`);
  }

  account.accessToken = data.access_token;
  account.expiresAt = new Date(Date.now() + (data.expires_in ?? 3600) * 1000);
  await account.save();
  return data.access_token;
}

// ─── Outlook message type ─────────────────────────────────────────────────────

interface OutlookMessage {
  id: string;
  subject?: string;
  receivedDateTime: string;
  from?: {
    emailAddress?: { address?: string; name?: string };
  };
  body?: { content?: string; contentType?: string };
  isRead?: boolean;
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ─── Main sync ────────────────────────────────────────────────────────────────

export async function syncOutlookAccount(
  accountId: string
): Promise<{ synced: number; errors: string[] }> {
  await connectDB();

  const account = await EmailAccountModel.findById(accountId);
  if (!account) throw new Error(`EmailAccount ${accountId} not found`);

  const token = await ensureFreshToken(account);
  const authHeader = { Authorization: `Bearer ${token}` };

  // Fetch up to 50 unread messages, newest first
  const listRes = await fetch(
    `${GRAPH_API}/me/messages?$filter=isRead eq false&$top=50&$orderby=receivedDateTime desc&$select=id,subject,from,body,receivedDateTime,isRead`,
    { headers: authHeader }
  );

  if (!listRes.ok) {
    const body = await listRes.text();
    throw new Error(`Outlook list error ${listRes.status}: ${body}`);
  }

  const listData = (await listRes.json()) as { value?: OutlookMessage[] };
  const messages = listData.value ?? [];

  let synced = 0;
  const errors: string[] = [];

  for (const msg of messages) {
    try {
      const exists = await EmailModel.exists({
        ownerId: account.ownerId,
        externalId: msg.id,
        provider: 'outlook',
      });
      if (exists) continue;

      const from =
        msg.from?.emailAddress?.address
          ? `${msg.from.emailAddress.name ?? ''} <${msg.from.emailAddress.address}>`.trim()
          : account.email;

      const rawBody = msg.body?.content ?? '(no body)';
      const body =
        msg.body?.contentType?.toLowerCase() === 'html' ? stripHtml(rawBody) : rawBody;

      await EmailModel.create({
        ownerId: account.ownerId,
        from,
        subject: msg.subject || '(no subject)',
        body,
        receivedAt: new Date(msg.receivedDateTime),
        category: 'UNCLASSIFIED',
        status: 'UNPROCESSED',
        externalId: msg.id,
        provider: 'outlook',
        accountId: account._id,
      });

      synced++;
    } catch (err) {
      errors.push(`msg ${msg.id}: ${String(err)}`);
    }
  }

  account.lastSyncAt = new Date();
  await account.save();

  return { synced, errors };
}
