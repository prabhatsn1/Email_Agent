import { connectDB } from '@/lib/db/mongo';
import { EmailModel } from '@/lib/db/models/Email';
import { DraftModel } from '@/lib/db/models/Draft';
import { ActionModel } from '@/lib/db/models/Action';
import { MemoryModel } from '@/lib/db/models/Memory';
import type { ToolCallResult } from '@/types/agent';
import type { EmailCategory } from '@/types/email';

// ─── readEmails ──────────────────────────────────────────────────────────────

export async function readEmailsForOwner(ownerId: string): Promise<ToolCallResult> {
  try {
    await connectDB();
    const emails = await EmailModel.find({ ownerId, status: 'UNPROCESSED' })
      .sort({ receivedAt: -1 })
      .limit(50)
      .lean();

    return { success: true, data: emails };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

function ownerEmailFilter(ownerId: string, emailId: string): { _id: string; ownerId: string } {
  return { _id: emailId, ownerId };
}

// ─── classifyEmail ───────────────────────────────────────────────────────────

export async function classifyEmail(
  ownerId: string,
  emailId: string,
  category: EmailCategory,
  reasoning: string,
  confidence: number
): Promise<ToolCallResult> {
  try {
    await connectDB();

    const email = await EmailModel.findOneAndUpdate(
      ownerEmailFilter(ownerId, emailId),
      { category, status: 'PROCESSING' },
      { new: true }
    );

    if (!email) return { success: false, error: `Email ${emailId} not found` };

    await ActionModel.create({
      ownerId,
      emailId,
      actionType: 'classify',
      reasoning,
      timestamp: new Date(),
      metadata: { category, confidence },
    });

    return { success: true, data: { emailId, category, reasoning, confidence } };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ─── draftReply ──────────────────────────────────────────────────────────────

export async function draftReply(
  ownerId: string,
  emailId: string,
  subject: string,
  body: string,
  confidence: number,
  reasoning: string
): Promise<ToolCallResult> {
  try {
    await connectDB();

    const email = await EmailModel.findOne(ownerEmailFilter(ownerId, emailId));
    if (!email) return { success: false, error: `Email ${emailId} not found` };

    const draft = await DraftModel.create({ ownerId, emailId, subject, body, confidence });

    await EmailModel.findOneAndUpdate(ownerEmailFilter(ownerId, emailId), { status: 'DRAFT_CREATED' });

    await ActionModel.create({
      ownerId,
      emailId,
      actionType: 'draft_reply',
      reasoning,
      timestamp: new Date(),
      metadata: { draftId: draft._id.toString(), subject, confidence },
    });

    return {
      success: true,
      data: { draftId: draft._id.toString(), subject, body, confidence },
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ─── scheduleFollowUp ────────────────────────────────────────────────────────

export async function scheduleFollowUp(
  ownerId: string,
  emailId: string,
  followUpDate: string,
  reasoning: string
): Promise<ToolCallResult> {
  try {
    await connectDB();

    const parsedDate = new Date(followUpDate);
    if (isNaN(parsedDate.getTime())) {
      return { success: false, error: `Invalid followUpDate: ${followUpDate}` };
    }

    const email = await EmailModel.findOneAndUpdate(
      ownerEmailFilter(ownerId, emailId),
      { followUpDate: parsedDate, status: 'FOLLOW_UP_SCHEDULED' },
      { new: true }
    );

    if (!email) return { success: false, error: `Email ${emailId} not found` };

    await ActionModel.create({
      ownerId,
      emailId,
      actionType: 'schedule_follow_up',
      reasoning,
      timestamp: new Date(),
      metadata: { followUpDate: parsedDate.toISOString() },
    });

    return { success: true, data: { emailId, followUpDate: parsedDate.toISOString() } };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ─── escalateEmail ───────────────────────────────────────────────────────────

export async function escalateEmail(
  ownerId: string,
  emailId: string,
  reason: string
): Promise<ToolCallResult> {
  try {
    await connectDB();

    const email = await EmailModel.findOneAndUpdate(
      ownerEmailFilter(ownerId, emailId),
      { status: 'ESCALATED', escalationReason: reason },
      { new: true }
    );

    if (!email) return { success: false, error: `Email ${emailId} not found` };

    await ActionModel.create({
      ownerId,
      emailId,
      actionType: 'escalate',
      reasoning: reason,
      timestamp: new Date(),
      metadata: { reason },
    });

    return { success: true, data: { emailId, reason } };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ─── storeMemory ─────────────────────────────────────────────────────────────

export async function storeMemory(
  ownerId: string,
  key: string,
  value: string,
  reasoning: string
): Promise<ToolCallResult> {
  try {
    await connectDB();

    await MemoryModel.findOneAndUpdate(
      { ownerId, key },
      { ownerId, key, value },
      { upsert: true, new: true }
    );

    return { success: true, data: { key, value, reasoning } };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ─── ignoreEmail (internal helper) ──────────────────────────────────────────

export async function ignoreEmail(
  ownerId: string,
  emailId: string,
  reasoning: string
): Promise<ToolCallResult> {
  try {
    await connectDB();

    await EmailModel.findOneAndUpdate(ownerEmailFilter(ownerId, emailId), { status: 'IGNORED' });

    await ActionModel.create({
      ownerId,
      emailId,
      actionType: 'ignore',
      reasoning,
      timestamp: new Date(),
    });

    return { success: true, data: { emailId, action: 'ignored' } };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ─── Tool dispatcher ─────────────────────────────────────────────────────────

export async function dispatchTool(
  ownerId: string,
  toolName: string,
  input: Record<string, unknown>
): Promise<ToolCallResult> {
  switch (toolName) {
    case 'readEmails':
      return readEmailsForOwner(ownerId);

    case 'classifyEmail':
      return classifyEmail(
        ownerId,
        input.emailId as string,
        input.category as EmailCategory,
        input.reasoning as string,
        input.confidence as number
      );

    case 'draftReply':
      return draftReply(
        ownerId,
        input.emailId as string,
        input.subject as string,
        input.body as string,
        input.confidence as number,
        input.reasoning as string
      );

    case 'scheduleFollowUp':
      return scheduleFollowUp(
        ownerId,
        input.emailId as string,
        input.followUpDate as string,
        input.reasoning as string
      );

    case 'escalateEmail':
      return escalateEmail(
        ownerId,
        input.emailId as string,
        input.reason as string
      );

    case 'storeMemory':
      return storeMemory(
        ownerId,
        input.key as string,
        input.value as string,
        input.reasoning as string
      );

    default:
      return { success: false, error: `Unknown tool: ${toolName}` };
  }
}
