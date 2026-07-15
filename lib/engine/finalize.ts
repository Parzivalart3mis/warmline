import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '@/lib/db';
import { messages, runs } from '@/db/schema';

/** §11 step 6 — settle counts and close the run. */
export async function finalizeRun(
  db: Db,
  runId: string,
): Promise<{ sent: number; failed: number; held: number; status: 'done' | 'cancelled' }> {
  const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  if (!run) return { sent: 0, failed: 0, held: 0, status: 'done' };

  // A cancelled run leaves nothing pending behind.
  if (run.cancelled) {
    await db
      .update(messages)
      .set({ status: 'cancelled' })
      .where(and(eq(messages.runId, runId), inArray(messages.status, ['draft', 'queued'])));
  }

  const rows = await db
    .select({ status: messages.status })
    .from(messages)
    .where(eq(messages.runId, runId));
  const count = (s: string) => rows.filter((r) => r.status === s).length;

  const sent = count('sent');
  const failed = count('failed');
  const held = count('needs_review');
  const status = run.cancelled ? 'cancelled' : 'done';

  await db
    .update(runs)
    .set({ status, sentCount: sent, failedCount: failed, heldCount: held, finishedAt: new Date() })
    .where(eq(runs.id, runId));

  return { sent, failed, held, status };
}

/** Mark the run as actively dripping (board shows the hairline). */
export async function markRunSending(db: Db, runId: string): Promise<void> {
  await db.update(runs).set({ status: 'sending' }).where(eq(runs.id, runId));
}
