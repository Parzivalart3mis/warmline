import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { runs } from '@/db/schema';
import { requireUserRecord } from '@/lib/auth';
import { assertRateLimit } from '@/lib/ratelimit';
import { readJson, route } from '@/lib/http';
import { runCreateSchema } from '@/lib/schemas';
import { startRun } from '@/lib/engine/start-run';

export const runtime = 'nodejs';
export const maxDuration = 60;

export const GET = route(async () => {
  const user = await requireUserRecord();
  const db = await getDb();
  const rows = await db
    .select()
    .from(runs)
    .where(eq(runs.userId, user.clerkUserId))
    .orderBy(desc(runs.startedAt))
    .limit(20);
  return NextResponse.json({ runs: rows });
});

/** Bulk run on demand — same pacing, same digest, same grace period. */
export const POST = route(async (req) => {
  const user = await requireUserRecord();
  await assertRateLimit('send', user.clerkUserId);
  const input = await readJson(req, runCreateSchema);
  const db = await getDb();

  const run = await startRun(db, user.clerkUserId, 'manual', input.contactIds);
  return NextResponse.json({ run }, { status: 201 });
});
