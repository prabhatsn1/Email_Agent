import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export interface DraftDocument extends Document {
  ownerId: string;
  emailId: Types.ObjectId;
  subject: string;
  body: string;
  confidence: number;
  createdAt: Date;
  updatedAt: Date;
}

const DraftSchema = new Schema<DraftDocument>(
  {
    ownerId: { type: String, required: true, index: true },
    emailId: { type: Schema.Types.ObjectId, ref: 'Email', required: true },
    subject: { type: String, required: true },
    body: { type: String, required: true },
    confidence: { type: Number, required: true, min: 0, max: 1 },
  },
  { timestamps: true }
);

DraftSchema.index({ ownerId: 1, emailId: 1 });

export const DraftModel: Model<DraftDocument> =
  mongoose.models.Draft ?? mongoose.model<DraftDocument>('Draft', DraftSchema);
