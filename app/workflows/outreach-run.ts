import { sleep } from 'workflow';
import { getDb } from '@/lib/db';
import { getMailSender } from '@/lib/mail';
import { planRun, GRACE_MS, type RunPlan } from '@/lib/engine/plan';
import {
  prepareContext,
  prepareDraft,
  prepareGate,
  type PrepareContext,
} from '@/lib/engine/prepare';
import { sendDigest } from '@/lib/engine/digest';
import { sendOne } from '@/lib/engine/send-one';
import { finalizeRun, markRunSending } from '@/lib/engine/finalize';

/**
 * §11 — the heart of the app. The workflow suspends in sleep() consuming no
 * compute, survives deploys, and retries failed steps. Every step is
 * idempotent: planRun re-plans nothing on retry (unique indexes), prepare
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

  // Step 3 — context → draft → faithfulness gate. Three steps per message,
  // not one: a single serverless invocation cannot carry a job-posting fetch,
  // grounded research, a draft, and a gate inside its time budget. Each step
  // retries independently. Flags become needs_review and are skipped by the
  // drip. Fail fast, before anything sends.
  for (const messageId of plan.messageIds) {
    const ctx = await stepContext(messageId);
    if (!ctx.ready) continue;
    await stepDraft(messageId, ctx);
    await stepGate(messageId, ctx);
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

async function stepContext(messageId: string): Promise<PrepareContext> {
  'use step';
  const db = await getDb();
  return prepareContext(db, messageId);
}

async function stepDraft(messageId: string, ctx: PrepareContext): Promise<void> {
  'use step';
  const db = await getDb();
  await prepareDraft(db, messageId, ctx);
}

async function stepGate(messageId: string, ctx: PrepareContext): Promise<string> {
  'use step';
  const db = await getDb();
  const { outcome } = await prepareGate(db, messageId, ctx);
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
