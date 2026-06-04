import { connectDB } from '@/lib/db/mongo';
import { EmailModel } from '@/lib/db/models/Email';
import { EmailAccountModel } from '@/lib/db/models/EmailAccount';
import type { EmailAccountDocument } from '@/lib/db/models/EmailAccount';

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

// ─── Token refresh ────────────────────────────────────────────────────────────

async function ensureFreshToken(account: EmailAccountDocument): Promise<string> {
  // Token still valid for at least 60s
  if (account.expiresAt > new Date(Date.now() + 60_000)) return account.accessToken;

  if (!account.refreshToken) throw new Error('No refresh token — user must re-authenticate');

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: account.refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  const data = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !data.access_token) {
    throw new Error(`Gmail token refresh failed: ${data.error ?? res.status}`);
  }

  account.accessToken = data.access_token;
  account.expiresAt = new Date(Date.now() + (data.expires_in ?? 3600) * 1000);
  await account.save();
  return data.access_token;
}

// ─── Gmail payload types ──────────────────────────────────────────────────────

interface GmailPart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
}

function getHeader(headers: Array<{ name: string; value: string }>, name: string): string {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

function extractBody(part: GmailPart): string {
  if (part.body?.data) {
    return Buffer.from(part.body.data, 'base64').toString('utf-8');
  }
  if (part.parts) {
    const plain = part.parts.find((p) => p.mimeType === 'text/plain');
    if (plain) {
      const body = extractBody(plain);
      if (body) return body;
    }
    for (const child of part.parts) {
      const body = extractBody(child);
      if (body) return body;
    }
  }
  return '';
}

// ─── Main sync ────────────────────────────────────────────────────────────────

export async function syncGmailAccount(
  accountId: string
): Promise<{ synced: number; errors: string[] }> {
  await connectDB();

  const account = await EmailAccountModel.findById(accountId);
  if (!account) throw new Error(`EmailAccount ${accountId} not found`);

  const token = await ensureFreshToken(account);
  const authHeader = { Authorization: `Bearer ${token}` };

  // Fetch up to 50 unread messages
  const listRes = await fetch(`${GMAIL_API}/messages?maxResults=50&q=is:unread`, {
    headers: authHeader,
  });
  if (!listRes.ok) {
    const body = await listRes.text();
    throw new Error(`Gmail list error ${listRes.status}: ${body}`);
  }

  const listData = (await listRes.json()) as { messages?: Array<{ id: string }> };
  const messages = listData.messages ?? [];

  let synced = 0;
  const errors: string[] = [];

  for (const msg of messages) {
    try {
      const exists = await EmailModel.exists({
        ownerId: account.ownerId,
        externalId: msg.id,
        provider: 'gmail',
      });
      if (exists) continue;

      const msgRes = await fetch(`${GMAIL_API}/messages/${msg.id}?format=full`, {
        headers: authHeader,
      });
      if (!msgRes.ok) continue;

      const msgData = (await msgRes.json()) as {
        payload: GmailPart & { headers: Array<{ name: string; value: string }> };
      };
      const payload = msgData.payload;
      const headers = payload.headers ?? [];

      const from = getHeader(headers, 'From');
      const subject = getHeader(headers, 'Subject') || '(no subject)';
      const date = getHeader(headers, 'Date');
      const body = extractBody(payload) || '(no body)';

      await EmailModel.create({
        ownerId: account.ownerId,
        from: from || account.email,
        subject,
        body,
        receivedAt: date ? new Date(date) : new Date(),
        category: 'UNCLASSIFIED',
        status: 'UNPROCESSED',
        externalId: msg.id,
        provider: 'gmail',
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
