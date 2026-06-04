import mongoose, { Schema, Document, Model } from 'mongoose';

export interface EmailAccountDocument extends Document {
  ownerId: string;
  provider: 'gmail' | 'outlook';
  email: string;
  name?: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date;
  lastSyncAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const EmailAccountSchema = new Schema<EmailAccountDocument>(
  {
    ownerId: { type: String, required: true, index: true },
    provider: { type: String, enum: ['gmail', 'outlook'], required: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    name: { type: String },
    accessToken: { type: String, required: true },
    refreshToken: { type: String },
    expiresAt: { type: Date, required: true },
    lastSyncAt: { type: Date },
  },
  { timestamps: true }
);

EmailAccountSchema.index({ ownerId: 1, provider: 1, email: 1 }, { unique: true });

export const EmailAccountModel: Model<EmailAccountDocument> =
  mongoose.models.EmailAccount ??
  mongoose.model<EmailAccountDocument>('EmailAccount', EmailAccountSchema);
