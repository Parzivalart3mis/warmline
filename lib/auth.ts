import { auth, currentUser } from '@clerk/nextjs/server';
import { eq } from 'drizzle-orm';
import { getDb } from './db';
import { users, type User } from '@/db/schema';
import { ApiError } from './http';

/**
 * Dev-only escape hatch: DEV_FAKE_USER=1 (and NODE_ENV=development) signs
 * every request in as the seed operator so the app can be driven locally
 * without real Clerk keys. Impossible to enable in production.
 */
const DEV_USER_ID = process.env.SEED_CLERK_USER_ID ?? 'user_seed_operator';

export function devFakeUserActive(): boolean {
  return process.env.NODE_ENV === 'development' && process.env.DEV_FAKE_USER === '1';
}

export async function getUserId(): Promise<string | null> {
  if (devFakeUserActive()) return DEV_USER_ID;
  const { userId } = await auth();
  return userId;
}

export async function requireUserId(): Promise<string> {
  const userId = await getUserId();
  if (!userId) throw new ApiError('UNAUTHORIZED', 'Sign in required.', 401);
  return userId;
}

/** Loads the operator row, bootstrapping it from Clerk on first touch. */
export async function requireUserRecord(): Promise<User> {
  const userId = await requireUserId();
  const db = await getDb();
  const existing = await db.select().from(users).where(eq(users.clerkUserId, userId)).limit(1);
  if (existing[0]) return existing[0];

  let email = process.env.GMAIL_USER ?? 'you@gmail.com';
  if (!devFakeUserActive()) {
    const clerkUser = await currentUser();
    email = clerkUser?.primaryEmailAddress?.emailAddress ?? email;
  }
  const inserted = await db
    .insert(users)
    .values({ clerkUserId: userId, email })
    .onConflictDoNothing()
    .returning();
  const row =
    inserted[0] ?? (await db.select().from(users).where(eq(users.clerkUserId, userId)).limit(1))[0];
  if (!row) throw new ApiError('INTERNAL', 'Could not initialize your account row.', 500);
  return row;
}
