import { and, eq } from 'drizzle-orm';
import type { LanguageModel } from 'ai';
import type { Db } from '@/lib/db';
import { contacts, messages, users, type ResearchFact } from '@/db/schema';
import { generateDraft } from '@/lib/ai/draft';
import { runGate, gateMode } from '@/lib/ai/gate';
import { researchCompany, isResearchFresh } from '@/lib/ai/research';
import { safeFetchText } from '@/lib/net/safe-fetch';
import { jobPostingText as extractJobText } from '@/lib/net/job-posting';
import { appendEvent } from './events';
import { resolveResumeForDraft } from './resolve-resume';

export type PrepareDeps = {
  draftModel?: LanguageModel;
  gateModel?: LanguageModel;
  groundedModel?: LanguageModel;
  structuringModel?: LanguageModel;
  selectModel?: LanguageModel;
  fetchPage?: (url: string) => Promise<string>;
};


export type PrepareOutcome = 'queued' | 'needs_review' | 'cancelled' | 'skipped';

/**
 * Everything the draft and gate steps need, gathered once. Workflow steps
 * persist their return values, so this is handed between steps rather than
 * re-fetched (and re-paid for) in each.
 */
export type PrepareContext =
  | { ready: false; outcome: PrepareOutcome }
  | {
      ready: true;
      resumeText: string;
      jobPostingText?: string;
      facts: ResearchFact[];
      grounded: boolean;
      resumeLabel: string | null;
      resumeVia: string;
      resumeReason?: string;
    };

/**
 * §11 step 3a — gather context: suppression re-check, job posting, resume
 * selection, grounded research. Split from drafting so no single serverless
 * invocation has to carry the whole pipeline.
 */
export async function prepareContext(
  db: Db,
  messageId: string,
  deps: PrepareDeps = {},
): Promise<PrepareContext> {
  const [message] = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
  if (!message) return { ready: false, outcome: 'skipped' };
  // Idempotent on step retry: anything past 'draft' was already prepared.
  if (message.status !== 'draft') {
    return { ready: false, outcome: message.status === 'queued' ? 'queued' : 'skipped' };
  }

  const [contact] = await db
    .select()
    .from(contacts)
    .where(eq(contacts.id, message.contactId))
    .limit(1);
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.clerkUserId, message.userId))
    .limit(1);
  if (!contact || !user) return { ready: false, outcome: 'skipped' };

  if (contact.suppressed) {
    await db.update(messages).set({ status: 'cancelled' }).where(eq(messages.id, messageId));
    await appendEvent(db, {
      userId: message.userId,
      type: 'suppressed',
      contactId: contact.id,
      messageId,
      payload: { where: 'prepare' },
    });
    return { ready: false, outcome: 'cancelled' };
  }

  // Job posting (SSRF-guarded), best-effort. Fetched first because it is a
  // primary signal for choosing which resume version to pitch.
  let jobPostingText: string | undefined;
  if (contact.jobUrl) {
    try {
      const fetchPage = deps.fetchPage ?? ((url: string) => safeFetchText(url));
      jobPostingText = extractJobText(await fetchPage(contact.jobUrl));
    } catch {
      jobPostingText = undefined;
    }
  }

  // Resume: explicit contact choice → AI selection → user default.
  const choice = await resolveResumeForDraft(
    db,
    { user, contact, ...(jobPostingText ? { jobPostingText } : {}) },
    deps.selectModel ? { selectModel: deps.selectModel } : {},
  );
  const resume = choice.resume;
  // Pin it to the message so the gate and the attachment use this exact version.
  if (resume && message.resumeId !== resume.id) {
    await db.update(messages).set({ resumeId: resume.id }).where(eq(messages.id, messageId));
  }

  // Research: cached on the contact for 14 days; re-ground only when stale.
  let facts: ResearchFact[] = contact.research ?? [];
  if (contact.researchOptIn && contact.company && !isResearchFresh(contact.researchedAt)) {
    facts = await researchCompany(
      {
        company: contact.company,
        contactRole: contact.contactRole,
        targetRole: contact.targetRole,
        ...(jobPostingText ? { jobPostingText } : {}),
        ...(contact.jobUrl ? { jobUrl: contact.jobUrl } : {}),
      },
      {
        ...(deps.groundedModel ? { groundedModel: deps.groundedModel } : {}),
        ...(deps.structuringModel ? { structuringModel: deps.structuringModel } : {}),
      },
    );
    await db
      .update(contacts)
      .set({ research: facts, researchedAt: new Date() })
      .where(eq(contacts.id, contact.id));
  }

  return {
    ready: true,
    resumeText: resume?.extractedText ?? '',
    // Trimmed to what the prompts actually use — this rides in workflow state.
    ...(jobPostingText ? { jobPostingText: jobPostingText.slice(0, 6_000) } : {}),
    facts,
    grounded: facts.length > 0,
    resumeLabel: resume?.label ?? null,
    resumeVia: choice.via,
    ...(choice.reason ? { resumeReason: choice.reason } : {}),
  };
}

/** §11 step 3b — write the letter. Skips an already-drafted (edited) message. */
export async function prepareDraft(
  db: Db,
  messageId: string,
  ctx: PrepareContext,
  deps: PrepareDeps = {},
): Promise<void> {
  if (!ctx.ready) return;
  const [message] = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
  if (!message || message.status !== 'draft') return;
  // An edited held draft keeps its text — only re-gated, never regenerated.
  if (message.body.trim() !== '') return;

  const [contact] = await db
    .select()
    .from(contacts)
    .where(eq(contacts.id, message.contactId))
    .limit(1);
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.clerkUserId, message.userId))
    .limit(1);
  if (!contact || !user) return;

  let previous: { subject: string; body: string } | undefined;
  if (message.step > 1) {
    const [parent] = await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.contactId, contact.id),
          eq(messages.step, message.step - 1),
          eq(messages.status, 'sent'),
        ),
      )
      .limit(1);
    if (parent) previous = { subject: parent.subject, body: parent.body };
  }

  const draft = await generateDraft(
    {
      resumeText: ctx.resumeText,
      tone: user.tone,
      contact: {
        firstName: contact.firstName,
        lastName: contact.lastName,
        company: contact.company,
        contactRole: contact.contactRole,
        targetRole: contact.targetRole,
        hook: contact.hook,
      },
      facts: ctx.facts,
      ...(ctx.jobPostingText ? { jobPostingText: ctx.jobPostingText } : {}),
      ...(previous ? { previous } : {}),
      step: message.step,
    },
    deps.draftModel ? { model: deps.draftModel } : {},
  );

  await db
    .update(messages)
    .set({ subject: draft.subject, body: draft.body, model: draft.model, grounded: ctx.grounded })
    .where(eq(messages.id, messageId));
  await appendEvent(db, {
    userId: message.userId,
    type: 'generated',
    contactId: contact.id,
    messageId,
    payload: {
      step: message.step,
      grounded: ctx.grounded,
      resume: ctx.resumeLabel,
      resumeVia: ctx.resumeVia,
      ...(ctx.resumeReason ? { resumeReason: ctx.resumeReason } : {}),
    },
  });
}

/** §11 step 3c — the faithfulness gate. Blocks on flag; fails closed on error. */
export async function prepareGate(
  db: Db,
  messageId: string,
  ctx: PrepareContext,
  deps: PrepareDeps = {},
): Promise<{ outcome: PrepareOutcome }> {
  if (!ctx.ready) return { outcome: ctx.outcome };
  const [message] = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
  if (!message) return { outcome: 'skipped' };
  if (message.status !== 'draft') {
    return { outcome: message.status === 'queued' ? 'queued' : 'skipped' };
  }

  const gate = await runGate(
    {
      subject: message.subject,
      body: message.body,
      resumeText: ctx.resumeText,
      facts: ctx.facts,
      ...(ctx.jobPostingText ? { jobPostingText: ctx.jobPostingText } : {}),
    },
    deps.gateModel ? { model: deps.gateModel } : {},
  );

  if (gate.verdict === 'pass' || (gate.verdict === 'flag' && gateMode() === 'warn')) {
    await db
      .update(messages)
      .set({
        status: 'queued',
        checkStatus: gate.verdict === 'pass' ? 'pass' : 'flag',
        checkIssues: gate.issues.length > 0 ? gate.issues : null,
      })
      .where(eq(messages.id, messageId));
    await appendEvent(db, {
      userId: message.userId,
      type: 'gate_passed',
      contactId: message.contactId,
      messageId,
      payload: gate.verdict === 'flag' ? { warnMode: true, issues: gate.issues.length } : {},
    });
    await appendEvent(db, {
      userId: message.userId,
      type: 'queued',
      contactId: message.contactId,
      messageId,
    });
    return { outcome: 'queued' };
  }

  await db
    .update(messages)
    .set({
      status: 'needs_review',
      checkStatus: gate.verdict === 'flag' ? 'flag' : 'error',
      checkIssues: gate.issues.length > 0 ? gate.issues : null,
      ...(gate.verdict === 'error'
        ? {
            errorCode: 'GATE_ERROR',
            errorMessage: 'The faithfulness check errored twice — held, not sent.',
          }
        : {}),
    })
    .where(eq(messages.id, messageId));
  await appendEvent(db, {
    userId: message.userId,
    type: 'gate_flagged',
    contactId: message.contactId,
    messageId,
    payload: { verdict: gate.verdict, issues: gate.issues.length },
  });
  return { outcome: 'needs_review' };
}

/**
 * The whole of §11 step 3 for ONE message, composed. The durable workflow
 * calls the three parts as separate steps (so each gets its own function
 * budget and retry); the inline dev runner uses this composition.
 */
export async function prepareOne(
  db: Db,
  messageId: string,
  deps: PrepareDeps = {},
): Promise<{ outcome: PrepareOutcome }> {
  const ctx = await prepareContext(db, messageId, deps);
  if (!ctx.ready) return { outcome: ctx.outcome };
  await prepareDraft(db, messageId, ctx, deps);
  return prepareGate(db, messageId, ctx, deps);
}
