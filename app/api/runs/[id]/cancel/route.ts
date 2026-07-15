import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireUserRecord } from '@/lib/auth';
import { assertRateLimit } from '@/lib/ratelimit';
import { ApiError, route } from '@/lib/http';
import { cancelRun } from '@/lib/engine/contact-actions';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/** Sets runs.cancelled — checked by sendOne before every send. */
export const POST = route<Ctx>(async (_req, ctx) => {
  const user = await requireUserRecord();
  await assertRateLimit('mutate', user.clerkUserId);
  const { id } = await ctx.params;
  const db = await getDb();

  const run = await cancelRun(db, user.clerkUserId, id);
  if (!run) throw new ApiError('NOT_FOUND', 'No such run.', 404);
  return NextResponse.json({ ok: true });
});
