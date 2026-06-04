import type { IEmail } from './email';

export interface AgentDecision {
  category: string;
  actionTaken: string;
  reasoning: string;
  nextStep: string;
}

export interface ToolCallResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface ClassifyEmailResult {
  category: 'CRITICAL' | 'IMPORTANT' | 'INFORMATIONAL' | 'NOISE';
  reasoning: string;
  confidence: number;
}

export interface DraftReplyResult {
  draftId: string;
  subject: string;
  body: string;
  confidence: number;
}

export interface ScheduleFollowUpResult {
  emailId: string;
  followUpDate: string;
}

export interface EscalateEmailResult {
  emailId: string;
  reason: string;
}

export interface StoreMemoryResult {
  key: string;
  value: string;
}

export interface AgentRunResult {
  processed: number;
  actions: Array<{
    emailId: string;
    action: string;
    reasoning: string;
  }>;
  errors: string[];
  duration: number;
}

export type ToolName =
  | 'readEmails'
  | 'classifyEmail'
  | 'draftReply'
  | 'scheduleFollowUp'
  | 'escalateEmail'
  | 'storeMemory';

export interface ToolCall {
  name: ToolName;
  input: Record<string, unknown>;
}

export interface ToolResult {
  toolName: ToolName;
  result: ToolCallResult;
}

export interface AgentRunOptions {
  ownerId: string;
  maxIterations?: number;
  dryRun?: boolean;
}

export interface EmailWithDraft extends IEmail {
  draft?: {
    subject: string;
    body: string;
    confidence: number;
  };
}
