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
 * What a prepare step returns to the workflow. Deliberately TINY: durable
 * workflows persist every step argument and result so they can replay, so
 * anything returned here is paid for repeatedly. The heavy context (resume
 * text, job posting, research) lives in the database and each step reads it.
 */
export type PrepareStepResult = { ready: boolean; outcome?: PrepareOutcome };

/** Everything the draft and gate steps need, loaded fresh from the database. */
type Prepared = {
  message: typeof messages.$inferSelect;
  contact: typeof contacts.$inferSelect;
  user: typeof users.$inferSelect;
  resumeText: string;
  resumeLabel: string | null;
  jobPostingText: string | undefined;
  facts: ResearchFact[];
};

async function load(db: Db, messageId: string): Promise<Prepared | null> {
  const [message] = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
  if (!message) return null;
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
  if (!contact || !user) return null;

  const { resumes } = await import('@/db/schema');
  const [resume] = message.resumeId
    ? await db.select().from(resumes).where(eq(resumes.id, message.resumeId)).limit(1)
    : [];

  return {
    message,
    contact,
    user,
    resumeText: resume?.extractedText ?? '',
    resumeLabel: resume?.label ?? null,
    jobPostingText: message.prepareMeta?.jobPostingText,
    facts: contact.research ?? [],
  };
}

/**
 * §11 step 3a — gather context and PERSIST it: suppression re-check, job
 * posting fetch, resume selection, grounded research. Returns only a ready
 * flag; the data itself is written to the database for the next steps.
 */
export async function prepareContext(
  db: Db,
  messageId: string,
  deps: PrepareDeps = {},
): Promise<PrepareStepResult> {
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
      jobPostingText = extractJobText(await fetchPage(contact.jobUrl)).slice(0, 6_000);
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

  // Research: cached on the contact for 14 days; re-ground only when stale.
  if (contact.researchOptIn && contact.company && !isResearchFresh(contact.researchedAt)) {
    const facts = await researchCompany(
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

  // Pin the resume and stash the context for the draft and gate steps.
  await db
    .update(messages)
    .set({
      ...(choice.resume ? { resumeId: choice.resume.id } : {}),
      prepareMeta: {
        ...(jobPostingText ? { jobPostingText } : {}),
        resumeVia: choice.via,
        ...(choice.reason ? { resumeReason: choice.reason } : {}),
      },
    })
    .where(eq(messages.id, messageId));

  return { ready: true };
}

/** §11 step 3b — write the letter. Skips an already-drafted (edited) message. */
export async function prepareDraft(
  db: Db,
  messageId: string,
  deps: PrepareDeps = {},
): Promise<void> {
  const p = await load(db, messageId);
  if (!p) return;
  const { message, contact, user } = p;
  if (message.status !== 'draft') return;
  // An edited held draft keeps its text — only re-gated, never regenerated.
  if (message.body.trim() !== '') return;

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

  const grounded = p.facts.length > 0;
  let draft: Awaited<ReturnType<typeof generateDraft>>;
  try {
    draft = await generateDraft(
      {
        resumeText: p.resumeText,
        tone: user.tone,
        contact: {
          firstName: contact.firstName,
          lastName: contact.lastName,
          company: contact.company,
          contactRole: contact.contactRole,
          targetRole: contact.targetRole,
          hook: contact.hook,
        },
        facts: p.facts,
        ...(p.jobPostingText ? { jobPostingText: p.jobPostingText } : {}),
        ...(previous ? { previous } : {}),
        step: message.step,
      },
      deps.draftModel ? { model: deps.draftModel } : {},
    );
  } catch (err) {
    // Record WHY before rethrowing. A failing workflow step is otherwise
    // invisible outside the platform's logs; this leaves a trail in the DB
    // while still letting the step retry.
    await db
      .update(messages)
      .set({
        errorCode: 'DRAFT_FAILED',
        errorMessage: (err instanceof Error ? `${err.name}: ${err.message}` : String(err)).slice(
          0,
          500,
        ),
      })
      .where(eq(messages.id, messageId));
    throw err;
  }

  await db
    .update(messages)
    .set({ subject: draft.subject, body: draft.body, model: draft.model, grounded })
    .where(eq(messages.id, messageId));
  await appendEvent(db, {
    userId: message.userId,
    type: 'generated',
    contactId: contact.id,
    messageId,
    payload: {
      step: message.step,
      grounded,
      resume: p.resumeLabel,
      resumeVia: message.prepareMeta?.resumeVia ?? null,
      ...(message.prepareMeta?.resumeReason
        ? { resumeReason: message.prepareMeta.resumeReason }
        : {}),
    },
  });
}

/** §11 step 3c — the faithfulness gate. Blocks on flag; fails closed on error. */
export async function prepareGate(
  db: Db,
  messageId: string,
  deps: PrepareDeps = {},
): Promise<{ outcome: PrepareOutcome }> {
  const p = await load(db, messageId);
  if (!p) return { outcome: 'skipped' };
  const { message } = p;
  if (message.status !== 'draft') {
    // Report what actually happened to it rather than a blanket "skipped".
    if (message.status === 'queued') return { outcome: 'queued' };
    if (message.status === 'cancelled') return { outcome: 'cancelled' };
    if (message.status === 'needs_review') return { outcome: 'needs_review' };
    return { outcome: 'skipped' };
  }

  const gate = await runGate(
    {
      subject: message.subject,
      body: message.body,
      resumeText: p.resumeText,
      facts: p.facts,
      ...(p.jobPostingText ? { jobPostingText: p.jobPostingText } : {}),
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
 * calls the three parts as separate steps, passing only the message id; the
 * inline dev runner uses this composition.
 */
export async function prepareOne(
  db: Db,
  messageId: string,
  deps: PrepareDeps = {},
): Promise<{ outcome: PrepareOutcome }> {
  const ctx = await prepareContext(db, messageId, deps);
  if (!ctx.ready) return { outcome: ctx.outcome ?? 'skipped' };
  await prepareDraft(db, messageId, deps);
  return prepareGate(db, messageId, deps);
}
