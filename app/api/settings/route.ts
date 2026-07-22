import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { resumes, users } from '@/db/schema';
import { requireUserRecord } from '@/lib/auth';
import { assertRateLimit } from '@/lib/ratelimit';
import { ApiError, readJson, route } from '@/lib/http';
import { settingsUpdateSchema } from '@/lib/schemas';

export const runtime = 'nodejs';

export const GET = route(async () => {
  const user = await requireUserRecord();
  return NextResponse.json({ settings: user });
});

export const PATCH = route(async (req) => {
  const user = await requireUserRecord();
  await assertRateLimit('mutate', user.clerkUserId);
  const input = await readJson(req, settingsUpdateSchema);
  const db = await getDb();

  // Cross-field sanity on the MERGED settings, not just the patch.
  const merged = {
    sendTime: input.sendTime ?? user.sendTime.slice(0, 5),
    windowStart: input.windowStart ?? user.windowStart.slice(0, 5),
    windowEnd: input.windowEnd ?? user.windowEnd.slice(0, 5),
    intervalSeconds: input.intervalSeconds ?? user.intervalSeconds,
    jitterSeconds: input.jitterSeconds ?? user.jitterSeconds,
  };
  if (merged.windowStart >= merged.windowEnd) {
    throw new ApiError('VALIDATION_ERROR', 'The window must start before it ends.', 400);
  }
  if (merged.sendTime < merged.windowStart || merged.sendTime > merged.windowEnd) {
    throw new ApiError('VALIDATION_ERROR', 'The send time must fall inside the window.', 400);
  }
  if (merged.jitterSeconds >= merged.intervalSeconds) {
    throw new ApiError('VALIDATION_ERROR', 'Jitter must be smaller than the interval.', 400);
  }

  if (input.defaultResumeId) {
    const [owned] = await db
      .select({ id: resumes.id })
      .from(resumes)
      .where(and(eq(resumes.id, input.defaultResumeId), eq(resumes.userId, user.clerkUserId)))
      .limit(1);
    if (!owned) throw new ApiError('NOT_FOUND', 'No such resume.', 404);
  }

  const updated = await db
    .update(users)
    .set({
      ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
      ...(input.sendTime !== undefined ? { sendTime: input.sendTime } : {}),
      ...(input.windowStart !== undefined ? { windowStart: input.windowStart } : {}),
      ...(input.windowEnd !== undefined ? { windowEnd: input.windowEnd } : {}),
      ...(input.weekdaysOnly !== undefined ? { weekdaysOnly: input.weekdaysOnly } : {}),
      ...(input.dailyCap !== undefined ? { dailyCap: input.dailyCap } : {}),
      ...(input.intervalSeconds !== undefined ? { intervalSeconds: input.intervalSeconds } : {}),
      ...(input.jitterSeconds !== undefined ? { jitterSeconds: input.jitterSeconds } : {}),
      ...(input.followupDays !== undefined ? { followupDays: input.followupDays } : {}),
      ...(input.maxFollowups !== undefined ? { maxFollowups: input.maxFollowups } : {}),
      ...(input.tone !== undefined ? { tone: input.tone } : {}),
      ...(input.defaultResumeId !== undefined ? { defaultResumeId: input.defaultResumeId } : {}),
      ...(input.autoSelectResume !== undefined
        ? { autoSelectResume: input.autoSelectResume }
        : {}),
    })
    .where(eq(users.clerkUserId, user.clerkUserId))
    .returning();

  if (input.defaultResumeId) {
    await db.update(resumes).set({ isDefault: false }).where(eq(resumes.userId, user.clerkUserId));
    await db.update(resumes).set({ isDefault: true }).where(eq(resumes.id, input.defaultResumeId));
  }

  return NextResponse.json({ settings: updated[0] });
});
