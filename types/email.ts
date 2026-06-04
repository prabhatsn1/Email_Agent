export type EmailCategory = 'CRITICAL' | 'IMPORTANT' | 'INFORMATIONAL' | 'NOISE' | 'UNCLASSIFIED';

export type EmailStatus =
  | 'UNPROCESSED'
  | 'PROCESSING'
  | 'IGNORED'
  | 'DRAFT_CREATED'
  | 'FOLLOW_UP_SCHEDULED'
  | 'ESCALATED'
  | 'DONE';

export interface IEmail {
  _id: string;
  from: string;
  subject: string;
  body: string;
  receivedAt: string;
  category: EmailCategory;
  status: EmailStatus;
  followUpDate?: string;
  escalationReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface IDraft {
  _id: string;
  emailId: string;
  subject: string;
  body: string;
  confidence: number;
  createdAt: string;
}

export interface IAgentAction {
  _id: string;
  emailId: string;
  actionType: 'classify' | 'draft_reply' | 'schedule_follow_up' | 'escalate' | 'ignore' | 'store_memory';
  reasoning: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface IMemory {
  _id: string;
  key: string;
  value: string;
  updatedAt: string;
}

export interface IEmailAccount {
  _id: string;
  provider: 'gmail' | 'outlook';
  email: string;
  name?: string;
  expiresAt: string;
  lastSyncAt?: string;
  createdAt: string;
  updatedAt: string;
}
