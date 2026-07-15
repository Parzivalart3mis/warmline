import { NextResponse } from 'next/server';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { contacts, messages } from '@/db/schema';
import { requireUserRecord } from '@/lib/auth';
import { assertRateLimit } from '@/lib/ratelimit';
import { ApiError, route } from '@/lib/http';
import { appendEvent } from '@/lib/engine/events';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export const POST = route<Ctx>(async (_req, ctx) => {
  const user = await requireUserRecord();
  await assertRateLimit('mutate', user.clerkUserId);
  const { id } = await ctx.params;
  const db = await getDb();

  const cancelled = await db
    .update(messages)
    .set({ status: 'cancelled' })
    .where(
      and(
        eq(messages.id, id),
        eq(messages.userId, user.clerkUserId),
        inArray(messages.status, ['draft', 'needs_review', 'queued']),
      ),
    )
    .returning();

  const message = cancelled[0];
  if (!message) {
    throw new ApiError('NOT_FOUND', 'No cancellable message with that id.', 404);
  }

  // A contact with nothing sent goes back to not_sent.
  await db
    .update(contacts)
    .set({
      status: sql`CASE WHEN EXISTS (SELECT 1 FROM messages WHERE messages.contact_id = ${message.contactId} AND messages.status = 'sent') THEN 'sent'::contact_status ELSE 'not_sent'::contact_status END`,
    })
    .where(and(eq(contacts.id, message.contactId), eq(contacts.status, 'queued')));

  await appendEvent(db, {
    userId: user.clerkUserId,
    type: 'cancelled',
    contactId: message.contactId,
    messageId: id,
  });
  return NextResponse.json({ ok: true });
});
