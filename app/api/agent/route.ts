import { NextRequest } from 'next/server';
import { runAgentLoop } from '@/lib/agent/agent';
import { getVisitorId } from '@/lib/auth/visitor';

export async function POST(request: NextRequest) {
  try {
    const ownerId = getVisitorId(request);
    const body = (await request.json().catch(() => ({}))) as {
      maxIterations?: number;
      dryRun?: boolean;
    };

    const result = await runAgentLoop({
      ownerId,
      maxIterations: body.maxIterations ?? 50,
      dryRun: body.dryRun ?? false,
    });

    return Response.json({ ok: true, result });
  } catch (err) {
    console.error('[agent] loop error:', err);
    return Response.json(
      { ok: false, error: String(err) },
      { status: 500 }
    );
  }
}

export async function GET() {
  return Response.json({
    ok: true,
    message: 'POST to this endpoint to trigger the agent loop',
    body: {
      maxIterations: 'number (optional, default 50)',
      dryRun: 'boolean (optional, default false)',
    },
  });
}
