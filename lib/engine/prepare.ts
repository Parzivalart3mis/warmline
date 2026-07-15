import { and, eq } from 'drizzle-orm';
import type { LanguageModel } from 'ai';
import type { Db } from '@/lib/db';
import { contacts, messages, resumes, users, type ResearchFact } from '@/db/schema';
import { generateDraft } from '@/lib/ai/draft';
import { runGate, gateMode } from '@/lib/ai/gate';
import { researchCompany, isResearchFresh } from '@/lib/ai/research';
import { safeFetchText } from '@/lib/net/safe-fetch';
import { htmlToText } from '@/lib/net/html-text';
import { appendEvent } from './events';

export type PrepareDeps = {
  draftModel?: LanguageModel;
  gateModel?: LanguageModel;
  groundedModel?: LanguageModel;
  structuringModel?: LanguageModel;
  fetchPage?: (url: string) => Promise<string>;
};

export type PrepareOutcome = 'queued' | 'needs_review' | 'cancelled' | 'skipped';

/**
 * §11 step 3 for ONE message: research → draft → faithfulness gate.
 * Runs as its own workflow step so each message gets its own retry budget
 * and no step invocation outlives a function timeout.
 */
export async function prepareOne(
  db: Db,
  messageId: string,
  deps: PrepareDeps = {},
): Promise<{ outcome: PrepareOutcome }> {
  const [message] = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
  if (!message) return { outcome: 'skipped' };
  // Idempotent on step retry: anything past 'draft' was already prepared.
  if (message.status !== 'draft') {
    return { outcome: message.status === 'queued' ? 'queued' : 'skipped' };
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
  if (!contact || !user) return { outcome: 'skipped' };

  if (contact.suppressed) {
    await db.update(messages).set({ status: 'cancelled' }).where(eq(messages.id, messageId));
    await appendEvent(db, {
      userId: message.userId,
      type: 'suppressed',
      contactId: contact.id,
      messageId,
      payload: { where: 'prepare' },
    });
    return { outcome: 'cancelled' };
  }

  // Resume: the contact's chosen version, else the user's default.
  const resumeId = contact.resumeId ?? user.defaultResumeId;
  const [resume] = resumeId
    ? await db.select().from(resumes).where(eq(resumes.id, resumeId)).limit(1)
    : await db
        .select()
        .from(resumes)
        .where(and(eq(resumes.userId, user.clerkUserId), eq(resumes.isDefault, true)))
        .limit(1);
  const resumeText = resume?.extractedText ?? '';

  // Job posting (SSRF-guarded), best-effort.
  let jobPostingText: string | undefined;
  if (contact.jobUrl) {
    try {
      const fetchPage = deps.fetchPage ?? ((url: string) => safeFetchText(url));
      jobPostingText = htmlToText(await fetchPage(contact.jobUrl));
    } catch {
      jobPostingText = undefined;
    }
  }

  // Research: cached on the contact for 14 days; re-ground only when stale.
  let facts: ResearchFact[] = contact.research ?? [];
  let grounded = facts.length > 0;
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
    grounded = facts.length > 0;
    await db
      .update(contacts)
      .set({ research: facts, researchedAt: new Date() })
      .where(eq(contacts.id, contact.id));
  }

  // Generate — unless this is an edited held draft being re-checked.
  let subject = message.subject;
  let body = message.body;
  if (body.trim() === '') {
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
        resumeText,
        tone: user.tone,
        contact: {
          firstName: contact.firstName,
          lastName: contact.lastName,
          company: contact.company,
          contactRole: contact.contactRole,
          targetRole: contact.targetRole,
          hook: contact.hook,
        },
        facts,
        ...(jobPostingText ? { jobPostingText } : {}),
        ...(previous ? { previous } : {}),
        step: message.step,
      },
      deps.draftModel ? { model: deps.draftModel } : {},
    );
    subject = draft.subject;
    body = draft.body;
    await db
      .update(messages)
      .set({ subject, body, model: draft.model, grounded })
      .where(eq(messages.id, messageId));
    await appendEvent(db, {
      userId: message.userId,
      type: 'generated',
      contactId: contact.id,
      messageId,
      payload: { step: message.step, grounded },
    });
  }

  // The gate. Blocks on flag; fails closed on error.
  const gate = await runGate(
    {
      subject,
      body,
      resumeText,
      facts,
      ...(jobPostingText ? { jobPostingText } : {}),
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
      contactId: contact.id,
      messageId,
      payload: gate.verdict === 'flag' ? { warnMode: true, issues: gate.issues.length } : {},
    });
    await appendEvent(db, {
      userId: message.userId,
      type: 'queued',
      contactId: contact.id,
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
    contactId: contact.id,
    messageId,
    payload: { verdict: gate.verdict, issues: gate.issues.length },
  });
  return { outcome: 'needs_review' };
}
