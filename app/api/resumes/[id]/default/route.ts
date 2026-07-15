import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { resumes, users } from '@/db/schema';
import { requireUserRecord } from '@/lib/auth';
import { assertRateLimit } from '@/lib/ratelimit';
import { ApiError, route } from '@/lib/http';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export const POST = route<Ctx>(async (_req, ctx) => {
  const user = await requireUserRecord();
  await assertRateLimit('mutate', user.clerkUserId);
  const { id } = await ctx.params;
  const db = await getDb();

  const [target] = await db
    .select()
    .from(resumes)
    .where(and(eq(resumes.id, id), eq(resumes.userId, user.clerkUserId)))
    .limit(1);
  if (!target) throw new ApiError('NOT_FOUND', 'No such resume.', 404);

  // Order matters with the partial unique index: clear, then set.
  await db.update(resumes).set({ isDefault: false }).where(eq(resumes.userId, user.clerkUserId));
  await db.update(resumes).set({ isDefault: true }).where(eq(resumes.id, id));
  await db
    .update(users)
    .set({ defaultResumeId: id })
    .where(eq(users.clerkUserId, user.clerkUserId));

  return NextResponse.json({ ok: true });
});
