import { NextRequest } from 'next/server';
import { connectDB } from '@/lib/db/mongo';
import { EmailModel } from '@/lib/db/models/Email';
import { DraftModel } from '@/lib/db/models/Draft';
import { getVisitorId } from '@/lib/auth/visitor';

// GET /api/emails — list emails with optional filters
export async function GET(request: NextRequest) {
  try {
    const ownerId = getVisitorId(request);
    await connectDB();

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const category = searchParams.get('category');
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 200);
    const page = Math.max(parseInt(searchParams.get('page') ?? '1', 10), 1);

    const filter: Record<string, unknown> = { ownerId };
    if (status) filter.status = status;
    if (category) filter.category = category;

    const [emails, total] = await Promise.all([
      EmailModel.find(filter)
        .sort({ receivedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      EmailModel.countDocuments(filter),
    ]);

    // Attach drafts for emails that have them
    const emailIds = emails.map((e) => e._id);
    const drafts = await DraftModel.find({ ownerId, emailId: { $in: emailIds } }).lean();
    const draftMap = new Map(drafts.map((d) => [d.emailId.toString(), d]));

    const enriched = emails.map((email) => ({
      ...email,
      draft: draftMap.get(email._id.toString()) ?? null,
    }));

    return Response.json({ ok: true, data: enriched, total, page, limit });
  } catch (err) {
    console.error('[emails] GET error:', err);
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  }
}

// POST /api/emails — ingest a new email
export async function POST(request: NextRequest) {
  try {
    const ownerId = getVisitorId(request);
    await connectDB();

    const body = (await request.json()) as {
      from: string;
      subject: string;
      body: string;
      receivedAt?: string;
    };

    if (!body.from || !body.subject || !body.body) {
      return Response.json(
        { ok: false, error: 'from, subject, and body are required' },
        { status: 400 }
      );
    }

    const email = await EmailModel.create({
      ownerId,
      from: body.from,
      subject: body.subject,
      body: body.body,
      receivedAt: body.receivedAt ? new Date(body.receivedAt) : new Date(),
      category: 'UNCLASSIFIED',
      status: 'UNPROCESSED',
    });

    return Response.json({ ok: true, data: email }, { status: 201 });
  } catch (err) {
    console.error('[emails] POST error:', err);
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
