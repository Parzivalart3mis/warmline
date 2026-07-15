import { and, eq, lt } from 'drizzle-orm';
import type { Db } from '@/lib/db';
import { messages } from '@/db/schema';
import { appendEvent } from './events';

const STUCK_AFTER_MS = 5 * 60_000;

/**
 * A message stuck in `sending` for >5 minutes may or may not have reached
 * Gmail. That is a human decision, not a machine one: move it to
 * needs_review, never auto-retry.
 */
export async function reconcileStuckSending(db: Db, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - STUCK_AFTER_MS);
  const stuck = await db
    .update(messages)
    .set({
      status: 'needs_review',
      checkStatus: 'error',
      errorCode: 'STUCK_SENDING',
      errorMessage:
        'This send started but never confirmed. Check your Gmail Sent folder before re-sending.',
    })
    .where(and(eq(messages.status, 'sending'), lt(messages.updatedAt, cutoff)))
    .returning();

  for (const m of stuck) {
    await appendEvent(db, {
      userId: m.userId,
      type: 'failed',
      contactId: m.contactId,
      messageId: m.id,
      payload: { code: 'STUCK_SENDING', reconciled: true },
    });
  }
  return stuck.length;
}
