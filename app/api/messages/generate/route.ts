import { streamObject } from 'ai';
import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { contacts, messages, type ResearchFact } from '@/db/schema';
import { requireUserRecord } from '@/lib/auth';
import { assertRateLimit } from '@/lib/ratelimit';
import { ApiError, readJson, route } from '@/lib/http';
import { generateSchema } from '@/lib/schemas';
import { draftPrompt, draftSchema } from '@/lib/ai/draft';
import { draftModel, DRAFT_MODEL_ID, DRAFT_PROVIDER_OPTIONS } from '@/lib/ai/models';
import { researchCompany, isResearchFresh } from '@/lib/ai/research';
import { safeFetchText } from '@/lib/net/safe-fetch';
import { htmlToText } from '@/lib/net/html-text';
import { appendEvent } from '@/lib/engine/events';
import { resolveResumeForDraft } from '@/lib/engine/resolve-resume';

export const runtime = 'nodejs';
export const maxDuration = 120;

/**
 * §7.2 individual-send path: streams the draft into the editor. The draft
 * row is pre-created (unique per contact+step) and its id returned in the
 * x-message-id header; onFinish persists the final subject/body.
 */
export const POST = route(async (req) => {
  const user = await requireUserRecord();
  await assertRateLimit('generate', user.clerkUserId);
  const { contactId, step = 1 } = await readJson(req, generateSchema);
  const db = await getDb();

  const [contact] = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.id, contactId), eq(contacts.userId, user.clerkUserId)))
    .limit(1);
  if (!contact) throw new ApiError('NOT_FOUND', 'No such contact.', 404);
  if (contact.suppressed) {
    throw new ApiError('SUPPRESSED', 'This contact is suppressed and will never be emailed.', 409);
  }

  // Reuse the live row for this (contact, step) or create one. The partial
  // unique index guarantees there is at most one.
  const existing = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.contactId, contact.id),
        eq(messages.step, step),
        inArray(messages.status, ['draft', 'needs_review', 'queued']),
      ),
    )
    .limit(1);
  let messageId: string;
  if (existing[0]) {
    if (existing[0].status === 'queued') {
      throw new ApiError(
        'ALREADY_QUEUED',
        'This email is already queued to send. Cancel it first to redraft.',
        409,
      );
    }
    messageId = existing[0].id;
  } else {
    const inserted = await db
      .insert(messages)
      .values({ userId: user.clerkUserId, contactId: contact.id, step, status: 'draft' })
      .returning();
    const row = inserted[0];
    if (!row) throw new ApiError('INTERNAL', 'Could not create the draft row.', 500);
    messageId = row.id;
  }

  // Context: job posting (SSRF-guarded) first — it's a signal for choosing
  // the resume version — then the resume, then cached research.
  let jobPostingText: string | undefined;
  if (contact.jobUrl) {
    try {
      jobPostingText = htmlToText(await safeFetchText(contact.jobUrl));
    } catch {
      jobPostingText = undefined;
    }
  }

  // Explicit contact choice → AI selection → user default.
  const choice = await resolveResumeForDraft(db, {
    user,
    contact,
    ...(jobPostingText ? { jobPostingText } : {}),
  });
  const resume = choice.resume;
  if (resume) {
    await db.update(messages).set({ resumeId: resume.id }).where(eq(messages.id, messageId));
  }

  let facts: ResearchFact[] = contact.research ?? [];
  if (contact.researchOptIn && contact.company && !isResearchFresh(contact.researchedAt)) {
    facts = await researchCompany({
      company: contact.company,
      contactRole: contact.contactRole,
      targetRole: contact.targetRole,
      ...(jobPostingText ? { jobPostingText } : {}),
      ...(contact.jobUrl ? { jobUrl: contact.jobUrl } : {}),
    });
    await db
      .update(contacts)
      .set({ research: facts, researchedAt: new Date() })
      .where(eq(contacts.id, contact.id));
  }

  let previous: { subject: string; body: string } | undefined;
  if (step > 1) {
    const [parent] = await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.contactId, contact.id),
          eq(messages.step, step - 1),
          eq(messages.status, 'sent'),
        ),
      )
      .limit(1);
    if (parent) previous = { subject: parent.subject, body: parent.body };
  }

  const { system, prompt } = draftPrompt({
    resumeText: resume?.extractedText ?? '',
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
    step,
  });

  const grounded = facts.length > 0;
  const result = streamObject({
    model: draftModel(),
    schema: draftSchema,
    system,
    prompt,
    providerOptions: DRAFT_PROVIDER_OPTIONS,
    onFinish: async ({ object }) => {
      if (!object) return;
      const subject = previous ? `Re: ${previous.subject}` : object.subject;
      await db
        .update(messages)
        .set({
          subject,
          body: object.body,
          model: DRAFT_MODEL_ID,
          grounded,
          status: 'draft',
          checkStatus: 'pending',
          checkIssues: null,
        })
        .where(eq(messages.id, messageId));
      await appendEvent(db, {
        userId: user.clerkUserId,
        type: 'generated',
        contactId: contact.id,
        messageId,
        payload: {
          step,
          grounded,
          streamed: true,
          resume: resume?.label ?? null,
          resumeVia: choice.via,
        },
      });
    },
  });

  return result.toTextStreamResponse({ headers: { 'x-message-id': messageId } });
});
