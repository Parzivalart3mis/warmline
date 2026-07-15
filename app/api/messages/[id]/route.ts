import { NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { messages } from '@/db/schema';
import { requireUserRecord } from '@/lib/auth';
import { assertRateLimit } from '@/lib/ratelimit';
import { ApiError, readJson, route } from '@/lib/http';
import { messagePatchSchema } from '@/lib/schemas';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/** Edit a held/draft message. Any edit resets the gate to pending. */
export const PATCH = route<Ctx>(async (req, ctx) => {
  const user = await requireUserRecord();
  await assertRateLimit('mutate', user.clerkUserId);
  const { id } = await ctx.params;
  const input = await readJson(req, messagePatchSchema);
  const db = await getDb();

  const updated = await db
    .update(messages)
    .set({
      ...(input.subject !== undefined ? { subject: input.subject } : {}),
      ...(input.body !== undefined ? { body: input.body } : {}),
      status: 'draft',
      checkStatus: 'pending',
      checkIssues: null,
    })
    .where(
      and(
        eq(messages.id, id),
        eq(messages.userId, user.clerkUserId),
        inArray(messages.status, ['draft', 'needs_review']),
      ),
    )
    .returning();

  const message = updated[0];
  if (!message) {
    throw new ApiError(
      'NOT_FOUND',
      'No editable message with that id (only drafts and held messages can be edited).',
      404,
    );
  }
  return NextResponse.json({ message });
});
