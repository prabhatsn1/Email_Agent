import mongoose from 'mongoose';

const DEFAULT_DEV_MONGODB_URI = 'mongodb://127.0.0.1:27017/email-agent';

interface MongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

declare global {
  var _mongooseCache: MongooseCache | undefined;
}

const cache: MongooseCache = global._mongooseCache ?? { conn: null, promise: null };
global._mongooseCache = cache;

function resolveMongoUri(): string {
  const configured = process.env.MONGODB_URI?.trim();
  if (configured) return configured;

  if (process.env.NODE_ENV !== 'production') {
    return DEFAULT_DEV_MONGODB_URI;
  }

  throw new Error('MONGODB_URI environment variable is not set');
}

export async function connectDB(): Promise<typeof mongoose> {
  if (cache.conn) return cache.conn;

  if (!cache.promise) {
    const mongoUri = resolveMongoUri();
    cache.promise = mongoose.connect(mongoUri, {
      bufferCommands: false,
    });
  }

  cache.conn = await cache.promise;
  return cache.conn;
}
