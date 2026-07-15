import { sleep } from 'workflow';
import { getDb } from '@/lib/db';
import { getMailSender } from '@/lib/mail';
import { planRun, GRACE_MS, type RunPlan } from '@/lib/engine/plan';
import { prepareOne } from '@/lib/engine/prepare';
import { sendDigest } from '@/lib/engine/digest';
import { sendOne } from '@/lib/engine/send-one';
import { finalizeRun, markRunSending } from '@/lib/engine/finalize';

/**
 * §11 — the heart of the app. The workflow suspends in sleep() consuming no
 * compute, survives deploys, and retries failed steps. Every step is
 * idempotent: planRun re-plans nothing on retry (unique indexes), prepareOne
 * skips non-drafts, sendOne's CAS claim makes double-delivery impossible.
 */
export async function outreachRun(runId: string, contactIds?: string[]) {
  'use workflow';

  // Step 1 — plan. Deterministic; delays are rolled INSIDE the step so the
  // orchestrator never calls Math.random().
  const plan = await stepPlan(runId, contactIds);
  if (plan.plannedCount === 0) {
    return await stepFinalize(runId);
  }

  // Step 2 — wait for the operator's real local send time (daily runs only).
  // Cron fired at an arbitrary UTC hour; this sleep is what makes 09:00
  // America/Chicago mean 09:00 in both CST and CDT.
  if (plan.kind === 'daily' && plan.msUntilSendTime > 0) {
    await sleep(plan.msUntilSendTime);
  }

  // Step 3 — research → draft → faithfulness gate, one step per message so
  // each gets its own retry budget. Flags become needs_review and are
  // skipped by the drip. Fail fast, before anything sends.
  for (const messageId of plan.messageIds) {
    await stepPrepare(messageId);
  }

  // Step 4 — digest to the operator, then the grace window to cancel.
  await stepDigest(runId, plan.messageIds);
  await sleep(GRACE_MS);
  await stepMarkSending(runId);

  // Step 5 — THE DRIP. One email. Sleep. Next.
  for (let i = 0; i < plan.messageIds.length; i++) {
    const messageId = plan.messageIds[i];
    if (!messageId) continue;
    const outcome = await stepSend(messageId);
    if (outcome === 'run_cancelled') break;
    if (i < plan.messageIds.length - 1) {
      await sleep(plan.delays[i] ?? 120_000); // ~2 minutes ± jitter, zero compute
    }
  }

  return await stepFinalize(runId);
}

async function stepPlan(runId: string, contactIds?: string[]): Promise<RunPlan> {
  'use step';
  const db = await getDb();
  return planRun(db, runId, contactIds ? { contactIds } : {});
}

async function stepPrepare(messageId: string): Promise<string> {
  'use step';
  const db = await getDb();
  const { outcome } = await prepareOne(db, messageId);
  return outcome;
}

async function stepDigest(runId: string, messageIds: string[]): Promise<void> {
  'use step';
  const db = await getDb();
  await sendDigest(db, getMailSender(), runId, messageIds);
}

async function stepMarkSending(runId: string): Promise<void> {
  'use step';
  const db = await getDb();
  await markRunSending(db, runId);
}

async function stepSend(messageId: string): Promise<string> {
  'use step';
  const db = await getDb();
  const outcome = await sendOne(db, getMailSender(), messageId);
  if ('cancelled' in outcome) return 'run_cancelled';
  if ('sent' in outcome) return 'sent';
  if ('failed' in outcome) return 'failed';
  return 'skipped';
}

async function stepFinalize(runId: string) {
  'use step';
  const db = await getDb();
  return finalizeRun(db, runId);
}
