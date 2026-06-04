import { NextRequest } from 'next/server';
import { syncAllAccounts } from '@/lib/sync/syncService';
import { getVisitorId } from '@/lib/auth/visitor';

// POST /api/sync — trigger sync for all connected accounts
export async function POST(request: NextRequest) {
  try {
    const ownerId = getVisitorId(request);
    const results = await syncAllAccounts(ownerId);
    const totalSynced = results.reduce((sum, r) => sum + r.synced, 0);
    const allErrors = results.flatMap((r) => r.errors);

    return Response.json({ ok: true, results, totalSynced, errors: allErrors });
  } catch (err) {
    console.error('[sync]', err);
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  }
}

export async function GET() {
  return Response.json({
    ok: true,
    message: 'POST to this endpoint to trigger email sync from all connected accounts',
  });
}
