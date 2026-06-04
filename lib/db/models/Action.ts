import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export type ActionType =
  | 'classify'
  | 'draft_reply'
  | 'schedule_follow_up'
  | 'escalate'
  | 'ignore'
  | 'store_memory';

export interface ActionDocument extends Document {
  ownerId: string;
  emailId: Types.ObjectId;
  actionType: ActionType;
  reasoning: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const ActionSchema = new Schema<ActionDocument>(
  {
    ownerId: { type: String, required: true, index: true },
    emailId: { type: Schema.Types.ObjectId, ref: 'Email', required: true },
    actionType: {
      type: String,
      enum: ['classify', 'draft_reply', 'schedule_follow_up', 'escalate', 'ignore', 'store_memory'],
      required: true,
    },
    reasoning: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
);

ActionSchema.index({ ownerId: 1, emailId: 1 });
ActionSchema.index({ actionType: 1 });
ActionSchema.index({ timestamp: -1 });

export const ActionModel: Model<ActionDocument> =
  mongoose.models.Action ?? mongoose.model<ActionDocument>('Action', ActionSchema);
