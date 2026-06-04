import mongoose, { Schema, Document, Model, Types } from 'mongoose';
import type { EmailCategory, EmailStatus } from '@/types/email';

export interface EmailDocument extends Document {
  ownerId: string;
  from: string;
  subject: string;
  body: string;
  receivedAt: Date;
  category: EmailCategory;
  status: EmailStatus;
  followUpDate?: Date;
  escalationReason?: string;
  externalId?: string;
  provider?: 'gmail' | 'outlook';
  accountId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const EmailSchema = new Schema<EmailDocument>(
  {
    ownerId: { type: String, required: true, index: true },
    from: { type: String, required: true, trim: true },
    subject: { type: String, required: true, trim: true },
    body: { type: String, required: true },
    receivedAt: { type: Date, required: true, default: Date.now },
    category: {
      type: String,
      enum: ['CRITICAL', 'IMPORTANT', 'INFORMATIONAL', 'NOISE', 'UNCLASSIFIED'],
      default: 'UNCLASSIFIED',
    },
    status: {
      type: String,
      enum: [
        'UNPROCESSED',
        'PROCESSING',
        'IGNORED',
        'DRAFT_CREATED',
        'FOLLOW_UP_SCHEDULED',
        'ESCALATED',
        'DONE',
      ],
      default: 'UNPROCESSED',
    },
    followUpDate: { type: Date },
    escalationReason: { type: String },
    externalId: { type: String },
    provider: { type: String, enum: ['gmail', 'outlook'] },
    accountId: { type: Schema.Types.ObjectId, ref: 'EmailAccount' },
  },
  { timestamps: true }
);

EmailSchema.index({ status: 1, receivedAt: -1 });
EmailSchema.index({ category: 1 });
EmailSchema.index({ ownerId: 1, externalId: 1, provider: 1 }, { unique: true, sparse: true });

export const EmailModel: Model<EmailDocument> =
  mongoose.models.Email ?? mongoose.model<EmailDocument>('Email', EmailSchema);
