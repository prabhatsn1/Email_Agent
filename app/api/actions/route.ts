import { NextRequest } from 'next/server';
import { connectDB } from '@/lib/db/mongo';
import { ActionModel } from '@/lib/db/models/Action';
import { MemoryModel } from '@/lib/db/models/Memory';
import { getVisitorId } from '@/lib/auth/visitor';

// GET /api/actions — list agent actions with optional filters
export async function GET(request: NextRequest) {
  try {
    const ownerId = getVisitorId(request);
    await connectDB();

    const { searchParams } = new URL(request.url);
    const emailId = searchParams.get('emailId');
    const actionType = searchParams.get('actionType');
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '100', 10), 500);
    const page = Math.max(parseInt(searchParams.get('page') ?? '1', 10), 1);

    const filter: Record<string, unknown> = { ownerId };
    if (emailId) filter.emailId = emailId;
    if (actionType) filter.actionType = actionType;

    const [actions, total, memories] = await Promise.all([
      ActionModel.find(filter)
        .sort({ timestamp: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('emailId', 'from subject category status')
        .lean(),
      ActionModel.countDocuments(filter),
      MemoryModel.find({ ownerId }).sort({ updatedAt: -1 }).lean(),
    ]);

    return Response.json({ ok: true, data: actions, total, page, limit, memories });
  } catch (err) {
    console.error('[actions] GET error:', err);
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
