import type { Db } from '@/lib/db';
import type { MailSender } from '@/lib/mail/sender';
import { planRun, GRACE_MS } from './plan';
import { prepareOne, type PrepareDeps } from './prepare';
import { sendDigest } from './digest';
import { sendOne } from './send-one';
import { finalizeRun, markRunSending } from './finalize';

/**
 * Dev/preview fallback: the exact §11 sequence without the durable runtime
 * (Workflows don't run in preview). Sleeps are compressed so the drip can be
 * exercised by hand. NEVER the production path. `prepareDeps` lets tests
 * inject mock models to drive the whole pipeline offline.
 */
export async function runInline(
  db: Db,
  mailer: MailSender,
  runId: string,
  opts: { maxSleepMs?: number; contactIds?: string[]; prepareDeps?: PrepareDeps } = {},
): Promise<void> {
  const cap = opts.maxSleepMs ?? 2_000;
  const nap = (ms: number) => new Promise((r) => setTimeout(r, Math.min(ms, cap)));

  const plan = await planRun(db, runId, opts.contactIds ? { contactIds: opts.contactIds } : {});
  if (plan.plannedCount === 0) {
    await finalizeRun(db, runId);
    return;
  }
  if (plan.kind === 'daily' && plan.msUntilSendTime > 0) await nap(plan.msUntilSendTime);

  for (const messageId of plan.messageIds) {
    await prepareOne(db, messageId, opts.prepareDeps ?? {});
  }

  await sendDigest(db, mailer, runId, plan.messageIds);
  await nap(GRACE_MS);
  await markRunSending(db, runId);

  for (let i = 0; i < plan.messageIds.length; i++) {
    const messageId = plan.messageIds[i];
    if (!messageId) continue;
    const outcome = await sendOne(db, mailer, messageId);
    if ('cancelled' in outcome) break;
    if (i < plan.messageIds.length - 1) await nap(plan.delays[i] ?? 120_000);
  }

  await finalizeRun(db, runId);
}
