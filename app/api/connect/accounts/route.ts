import { NextRequest } from 'next/server';
import { connectDB } from '@/lib/db/mongo';
import { EmailAccountModel } from '@/lib/db/models/EmailAccount';
import { getVisitorId } from '@/lib/auth/visitor';

// GET /api/connect/accounts — list connected accounts (tokens omitted)
export async function GET(request: NextRequest) {
  try {
    const ownerId = getVisitorId(request);
    await connectDB();
    const accounts = await EmailAccountModel.find({ ownerId })
      .select('-accessToken -refreshToken')
      .sort({ createdAt: -1 })
      .lean();
    return Response.json({ ok: true, data: accounts });
  } catch (err) {
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  }
}

// DELETE /api/connect/accounts?id=<accountId> — disconnect an account
export async function DELETE(request: NextRequest) {
  try {
    const id = new URL(request.url).searchParams.get('id');
    if (!id) return Response.json({ ok: false, error: 'id required' }, { status: 400 });
    const ownerId = getVisitorId(request);

    await connectDB();
    await EmailAccountModel.findOneAndDelete({ _id: id, ownerId });
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
