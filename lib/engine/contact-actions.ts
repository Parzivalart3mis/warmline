import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '@/lib/db';
import { contacts, messages, runs, suppressions } from '@/db/schema';
import { appendEvent } from './events';

const PENDING: Array<'draft' | 'needs_review' | 'queued'> = ['draft', 'needs_review', 'queued'];

async function cancelPendingMessages(db: Db, userId: string, contactId: string): Promise<number> {
  const cancelled = await db
    .update(messages)
    .set({ status: 'cancelled' })
    .where(
      and(
        eq(messages.userId, userId),
        eq(messages.contactId, contactId),
        inArray(messages.status, PENDING),
      ),
    )
    .returning();
  for (const m of cancelled) {
    await appendEvent(db, {
      userId,
      type: 'cancelled',
      contactId,
      messageId: m.id,
      payload: { step: m.step },
    });
  }
  return cancelled.length;
}

/** Marking replied cancels all pending follow-ups for them, permanently. */
export async function markReplied(db: Db, userId: string, contactId: string) {
  const updated = await db
    .update(contacts)
    .set({ status: 'replied', repliedAt: new Date() })
    .where(and(eq(contacts.id, contactId), eq(contacts.userId, userId)))
    .returning();
  const contact = updated[0];
  if (!contact) return null;
  await cancelPendingMessages(db, userId, contactId);
  await appendEvent(db, { userId, type: 'replied', contactId });
  return contact;
}

/** Suppression is absolute: list entry + flag + cancel anything pending. */
export async function suppressContact(db: Db, userId: string, contactId: string, reason = '') {
  const updated = await db
    .update(contacts)
    .set({ status: 'suppressed', suppressed: true })
    .where(and(eq(contacts.id, contactId), eq(contacts.userId, userId)))
    .returning();
  const contact = updated[0];
  if (!contact) return null;
  await db
    .insert(suppressions)
    .values({ userId, email: contact.email, reason })
    .onConflictDoNothing();
  await cancelPendingMessages(db, userId, contactId);
  await appendEvent(db, { userId, type: 'suppressed', contactId, payload: { reason } });
  return contact;
}

/** Cancel a run: flag checked by sendOne before every send; pending rows drop. */
export async function cancelRun(db: Db, userId: string, runId: string) {
  const updated = await db
    .update(runs)
    .set({ cancelled: true })
    .where(and(eq(runs.id, runId), eq(runs.userId, userId)))
    .returning();
  const run = updated[0];
  if (!run) return null;

  const dropped = await db
    .update(messages)
    .set({ status: 'cancelled' })
    .where(
      and(
        eq(messages.runId, runId),
        eq(messages.userId, userId),
        inArray(messages.status, ['draft', 'queued']),
      ),
    )
    .returning();

  for (const m of dropped) {
    // Contacts with no sent mail go back to not_sent so tomorrow picks them up.
    await db
      .update(contacts)
      .set({
        status: sql`CASE WHEN EXISTS (SELECT 1 FROM messages WHERE messages.contact_id = ${m.contactId} AND messages.status = 'sent') THEN 'sent'::contact_status ELSE 'not_sent'::contact_status END`,
      })
      .where(and(eq(contacts.id, m.contactId), eq(contacts.status, 'queued')));
    await appendEvent(db, {
      userId,
      type: 'cancelled',
      contactId: m.contactId,
      messageId: m.id,
      payload: { runId },
    });
  }

  await appendEvent(db, { userId, type: 'cancelled', payload: { runId, dropped: dropped.length } });
  return run;
}
