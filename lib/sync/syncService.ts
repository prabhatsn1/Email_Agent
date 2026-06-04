import { connectDB } from '@/lib/db/mongo';
import { EmailAccountModel } from '@/lib/db/models/EmailAccount';
import { syncGmailAccount } from './gmail';
import { syncOutlookAccount } from './outlook';

export interface SyncResult {
  accountId: string;
  provider: 'gmail' | 'outlook';
  email: string;
  synced: number;
  errors: string[];
}

export async function syncAllAccounts(ownerId: string): Promise<SyncResult[]> {
  await connectDB();
  const accounts = await EmailAccountModel.find({ ownerId }).lean();
  const results: SyncResult[] = [];

  for (const account of accounts) {
    try {
      const fn = account.provider === 'gmail' ? syncGmailAccount : syncOutlookAccount;
      const { synced, errors } = await fn(account._id.toString());
      results.push({
        accountId: account._id.toString(),
        provider: account.provider,
        email: account.email,
        synced,
        errors,
      });
    } catch (err) {
      results.push({
        accountId: account._id.toString(),
        provider: account.provider,
        email: account.email,
        synced: 0,
        errors: [String(err)],
      });
    }
  }

  return results;
}
