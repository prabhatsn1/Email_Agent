import { connectDB } from '@/lib/db/mongo';
import mongoose from 'mongoose';
import Groq from 'groq-sdk';

export async function GET() {
  const [db, ai] = await Promise.allSettled([checkMongo(), checkGroq()]);

  return Response.json({
    db: db.status === 'fulfilled' ? db.value : { ok: false, error: String((db as PromiseRejectedResult).reason) },
    ai: ai.status === 'fulfilled' ? ai.value : { ok: false, error: String((ai as PromiseRejectedResult).reason) },
  });
}

async function checkMongo(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  if (!process.env.MONGODB_URI) {
    return { ok: false, error: 'MONGODB_URI not set' };
  }
  try {
    const t = Date.now();
    await connectDB();
    await mongoose.connection.db?.admin().ping();
    return { ok: true, latencyMs: Date.now() - t };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function checkGroq(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  if (!process.env.GROQ_API_KEY) {
    return { ok: false, error: 'GROQ_API_KEY not set' };
  }
  try {
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const t = Date.now();
    await groq.models.list();
    return { ok: true, latencyMs: Date.now() - t };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
