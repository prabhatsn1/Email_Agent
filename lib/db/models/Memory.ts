import mongoose, { Schema, Document, Model } from 'mongoose';

export interface MemoryDocument extends Document {
  ownerId: string;
  key: string;
  value: string;
  updatedAt: Date;
}

const MemorySchema = new Schema<MemoryDocument>(
  {
    ownerId: { type: String, required: true, index: true },
    key: { type: String, required: true, trim: true },
    value: { type: String, required: true },
  },
  {
    timestamps: true,
    // Only `updatedAt` matters for memory — createdAt is implicitly tracked too
  }
);

MemorySchema.index({ ownerId: 1, key: 1 }, { unique: true });

export const MemoryModel: Model<MemoryDocument> =
  mongoose.models.Memory ?? mongoose.model<MemoryDocument>('Memory', MemorySchema);
