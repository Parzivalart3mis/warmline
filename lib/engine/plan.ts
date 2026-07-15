import { and, eq, inArray, isNull, notExists, sql } from 'drizzle-orm';
import type { Db } from '@/lib/db';
import { contacts, messages, runs, suppressions, users } from '@/db/schema';
import {
  capacityInWindow,
  isWeekendIn,
  localInstant,
  msUntilLocalTime,
} from '@/lib/schedule/local-time';
import { computeDelays } from '@/lib/schedule/delays';
import { appendEvent } from './events';

/** Digest goes out, then a 10-minute grace period before the drip starts. */
export const GRACE_MS = 10 * 60_000;

export type RunPlan = {
  runId: string;
  kind: 'daily' | 'manual';
  /** ms the workflow sleeps before preparing (daily only; 0 for manual). */
  msUntilSendTime: number;
  /** Per-gap delays, jitter already rolled — the orchestrator never calls Math.random(). */
  delays: number[];
  messageIds: string[];
  plannedCount: number;
};

const emptyPlan = (runId: string, kind: 'daily' | 'manual'): RunPlan => ({
  runId,
  kind,
  msUntilSendTime: 0,
  delays: [],
  messageIds: [],
  plannedCount: 0,
});

/**
 * Deterministic planning (§11 step 1):
 *  - initial sends: contacts still not_sent
 *  - follow-ups due: sent ≥ followupDays ago, never replied, step < max+1
 *  - adopts orphaned queued messages (e.g. held drafts fixed after their run)
 *  - filters suppressed at the planner (checkpoint 2 of 3)
 *  - respects daily_cap, weekdays_only, and the send window (daily runs)
 */
export async function planRun(
  db: Db,
  runId: string,
  opts: { now?: Date; rng?: () => number; contactIds?: string[] | undefined } = {},
): Promise<RunPlan> {
  const now = opts.now ?? new Date();

  const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  if (!run || run.cancelled) return emptyPlan(runId, run?.kind ?? 'manual');
  const [user] = await db.select().from(users).where(eq(users.clerkUserId, run.userId)).limit(1);
  if (!user) return emptyPlan(runId, run.kind);

  // Idempotent re-entry (step retry, or a subset already planned at start):
  // if this run already owns messages, reconstruct the plan from them instead
  // of re-selecting candidates whose statuses have since changed.
  const existing = await db
    .select()
    .from(messages)
    .where(eq(messages.runId, runId))
    .orderBy(messages.scheduledFor, messages.createdAt);
  if (existing.length > 0) {
    const liveIds = existing.filter((m) => m.status !== 'cancelled').map((m) => m.id);
    const rngR = opts.rng ?? Math.random;
    return {
      runId,
      kind: run.kind,
      msUntilSendTime:
        run.kind === 'daily' ? msUntilLocalTime(now, user.timezone, user.sendTime) : 0,
      delays: computeDelays(
        Math.max(0, liveIds.length - 1),
        user.intervalSeconds,
        user.jitterSeconds,
        rngR,
      ),
      messageIds: liveIds,
      plannedCount: liveIds.length,
    };
  }

  const finishEmpty = async (): Promise<RunPlan> => {
    await db
      .update(runs)
      .set({ status: 'done', plannedCount: 0, finishedAt: new Date() })
      .where(eq(runs.id, runId));
    return emptyPlan(runId, run.kind);
  };

  // Weekends roll to the next eligible day (the next daily cron).
  if (run.kind === 'daily' && user.weekdaysOnly && isWeekendIn(now, user.timezone)) {
    return finishEmpty();
  }

  // When the drip starts: daily runs sleep to the local send time (clamped
  // into the window); manual runs start now. +GRACE_MS for the digest window.
  let msUntilSendTime = 0;
  let dripStart = new Date(now.getTime() + GRACE_MS);
  let capacity = user.dailyCap;

  if (run.kind === 'daily') {
    const sendAt = localInstant(now, user.timezone, user.sendTime);
    const windowStart = localInstant(now, user.timezone, user.windowStart);
    const windowEnd = localInstant(now, user.timezone, user.windowEnd);
    const wake = new Date(
      Math.max(now.getTime(), Math.max(sendAt.getTime(), windowStart.getTime())),
    );
    msUntilSendTime = Math.max(0, wake.getTime() - now.getTime());
    dripStart = new Date(wake.getTime() + GRACE_MS);
    // If the drip would run past the window, the surplus rolls to the next
    // eligible day rather than sending at 2am.
    capacity = Math.min(
      user.dailyCap,
      capacityInWindow(dripStart, windowEnd, user.intervalSeconds),
    );
  }

  if (capacity <= 0) return finishEmpty();

  const notSuppressedByList = notExists(
    db
      .select({ one: sql`1` })
      .from(suppressions)
      .where(and(eq(suppressions.userId, run.userId), eq(suppressions.email, contacts.email))),
  );

  // Adopt orphaned queued messages first (fixed held drafts, prior stragglers).
  const orphanFilter = and(
    eq(messages.userId, run.userId),
    eq(messages.status, 'queued'),
    isNull(messages.runId),
  );
  const orphans = await db.select().from(messages).where(orphanFilter);
  if (orphans.length > 0) {
    await db.update(messages).set({ runId }).where(orphanFilter);
  }

  // Initial sends.
  const initialWhere = [
    eq(contacts.userId, run.userId),
    eq(contacts.status, 'not_sent'),
    eq(contacts.suppressed, false),
    notSuppressedByList,
  ];
  if (opts.contactIds && opts.contactIds.length > 0) {
    initialWhere.push(inArray(contacts.id, opts.contactIds));
  }
  const initialCandidates = await db
    .select()
    .from(contacts)
    .where(and(...initialWhere))
    .orderBy(contacts.createdAt);

  // Follow-ups due.
  const followupWhere = [
    eq(contacts.userId, run.userId),
    eq(contacts.status, 'sent'),
    eq(contacts.suppressed, false),
    isNull(contacts.repliedAt),
    notSuppressedByList,
  ];
  if (opts.contactIds && opts.contactIds.length > 0) {
    followupWhere.push(inArray(contacts.id, opts.contactIds));
  }
  const sentContacts = await db
    .select()
    .from(contacts)
    .where(and(...followupWhere))
    .orderBy(contacts.createdAt);

  const followupCandidates: Array<{
    contact: (typeof sentContacts)[number];
    step: number;
    parent: { subject: string; rfcMessageId: string | null; references: string | null };
  }> = [];

  if (sentContacts.length > 0) {
    const sentMessages = await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.userId, run.userId),
          eq(messages.status, 'sent'),
          inArray(
            messages.contactId,
            sentContacts.map((c) => c.id),
          ),
        ),
      );
    const dueBefore = now.getTime() - user.followupDays * 24 * 3_600_000;
    for (const contact of sentContacts) {
      const thread = sentMessages
        .filter((m) => m.contactId === contact.id)
        .sort((a, b) => b.step - a.step);
      const last = thread[0];
      if (!last || !last.sentAt) continue;
      if (last.step >= user.maxFollowups + 1) continue; // step 1 + N follow-ups
      if (last.sentAt.getTime() > dueBefore) continue;
      followupCandidates.push({
        contact,
        step: last.step + 1,
        parent: {
          subject: last.subject,
          rfcMessageId: last.rfcMessageId,
          references: last.references,
        },
      });
    }
  }

  // Follow-ups first (time-sensitive), then fresh contacts, capped.
  type Planned =
    | { type: 'initial'; contact: (typeof initialCandidates)[number] }
    | {
        type: 'followup';
        contact: (typeof initialCandidates)[number];
        step: number;
        parent: { subject: string; rfcMessageId: string | null; references: string | null };
      };

  const room = Math.max(0, capacity - orphans.length);
  const selected: Planned[] = [
    ...followupCandidates.map((f) => ({
      type: 'followup' as const,
      contact: f.contact,
      step: f.step,
      parent: f.parent,
    })),
    ...initialCandidates.map((c) => ({ type: 'initial' as const, contact: c })),
  ].slice(0, room);

  const rng = opts.rng ?? Math.random;
  const totalCount = orphans.length + selected.length;
  const delays = computeDelays(
    Math.max(0, totalCount - 1),
    user.intervalSeconds,
    user.jitterSeconds,
    rng,
  );

  const messageIds: string[] = orphans.map((m) => m.id);
  let cursorMs = dripStart.getTime();
  // Orphans occupy the first drip slots; selected messages start after them.
  for (let k = 0; k < orphans.length; k++) {
    cursorMs += delays[k] ?? user.intervalSeconds * 1000;
  }

  for (const [i, planned] of selected.entries()) {
    const position = orphans.length + i;
    const scheduledFor = new Date(cursorMs);
    cursorMs += delays[position] ?? user.intervalSeconds * 1000;

    try {
      const inserted = await db
        .insert(messages)
        .values({
          userId: run.userId,
          contactId: planned.contact.id,
          step: planned.type === 'followup' ? planned.step : 1,
          runId,
          status: 'draft',
          checkStatus: 'pending',
          scheduledFor,
          ...(planned.type === 'followup'
            ? {
                subject: `Re: ${planned.parent.subject}`,
                inReplyTo: planned.parent.rfcMessageId,
                references: [planned.parent.references, planned.parent.rfcMessageId]
                  .filter(Boolean)
                  .join(' '),
              }
            : {}),
        })
        .returning();
      const row = inserted[0];
      if (!row) continue;
      messageIds.push(row.id);
      await db
        .update(contacts)
        .set({ status: 'queued' })
        .where(eq(contacts.id, planned.contact.id));
    } catch {
      // Partial unique indexes rejected it (already-pending or duplicate step).
      // The index is the backstop — skip quietly.
    }
  }

  await db
    .update(runs)
    .set({ status: 'waiting', plannedCount: messageIds.length })
    .where(eq(runs.id, runId));

  await appendEvent(db, {
    userId: run.userId,
    type: 'queued',
    payload: { runId, planned: messageIds.length, kind: run.kind },
  });

  return {
    runId,
    kind: run.kind,
    msUntilSendTime,
    delays,
    messageIds,
    plannedCount: messageIds.length,
  };
}
