import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { and, eq, gte } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { runs, users } from '@/db/schema';
import { jsonError, route } from '@/lib/http';
import { startRun } from '@/lib/engine/start-run';
import { reconcileStuckSending } from '@/lib/engine/reconcile';
import { localInstant } from '@/lib/schedule/local-time';

export const runtime = 'nodejs';
export const maxDuration = 60;

function bearerMatches(header: string | null, secret: string | undefined): boolean {
  if (!header || !secret) return false;
  const given = Buffer.from(header.replace(/^Bearer\s+/i, ''));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Fires once daily at 06:00 UTC (deliberately early — Hobby cron is UTC-only
 * and may land anywhere in the hour). It only STARTS the workflow; the
 * workflow's sleep() lands the sends on the operator's real local send time.
 */
export const GET = route(async (req) => {
  if (!bearerMatches(req.headers.get('authorization'), process.env.CRON_SECRET)) {
    return jsonError('UNAUTHORIZED', 'Bad or missing bearer token.', 401);
  }

  const db = await getDb();
  await reconcileStuckSending(db);

  const operators = await db.select().from(users);
  let started: string | null = null;

  for (const operator of operators) {
    // Idempotence against double-fires: one daily run per local day.
    const localMidnight = localInstant(new Date(), operator.timezone, '00:00');
    const existing = await db
      .select({ id: runs.id })
      .from(runs)
      .where(
        and(
          eq(runs.userId, operator.clerkUserId),
          eq(runs.kind, 'daily'),
          gte(runs.startedAt, localMidnight),
        ),
      )
      .limit(1);
    if (existing[0]) continue;

    const run = await startRun(db, operator.clerkUserId, 'daily');
    started ??= run.id;
  }

  return NextResponse.json({ started });
});
