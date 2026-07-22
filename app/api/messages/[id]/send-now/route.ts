import { NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { contacts, messages, resumes } from '@/db/schema';
import { requireUserRecord } from '@/lib/auth';
import { assertRateLimit } from '@/lib/ratelimit';
import { ApiError, route } from '@/lib/http';
import { runGate, gateMode } from '@/lib/ai/gate';
import { sendOne } from '@/lib/engine/send-one';
import { getMailSender } from '@/lib/mail';

export const runtime = 'nodejs';
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/**
 * Individual send, immediate. The faithfulness gate still stands on this
 * path — there is no auto-send override: a flagged draft stays held until
 * the operator edits it into something the gate passes.
 */
export const POST = route<Ctx>(async (_req, ctx) => {
  const user = await requireUserRecord();
  await assertRateLimit('send', user.clerkUserId);
  const { id } = await ctx.params;
  const db = await getDb();

  const [message] = await db
    .select()
    .from(messages)
    .where(and(eq(messages.id, id), eq(messages.userId, user.clerkUserId)))
    .limit(1);
  if (!message) throw new ApiError('NOT_FOUND', 'No such message.', 404);
  if (!['draft', 'needs_review', 'queued', 'failed'].includes(message.status)) {
    throw new ApiError('CONFLICT', `This message is ${message.status} — nothing to send.`, 409);
  }
  if (!message.subject.trim() || !message.body.trim()) {
    throw new ApiError('EMPTY_DRAFT', 'Generate or write the draft before sending.', 422);
  }

  const mailer = getMailSender();

  const [contact] = await db
    .select()
    .from(contacts)
    .where(eq(contacts.id, message.contactId))
    .limit(1);
  if (!contact) throw new ApiError('NOT_FOUND', 'The contact for this message is gone.', 404);
  if (contact.suppressed) {
    throw new ApiError('SUPPRESSED', 'This contact is suppressed and will never be emailed.', 409);
  }

  // Re-run the gate on the exact text that would go out.
  // Re-gate against the version this draft was written from.
  const resumeId = message.resumeId ?? contact.resumeId ?? user.defaultResumeId;
  const [resume] = resumeId
    ? await db.select().from(resumes).where(eq(resumes.id, resumeId)).limit(1)
    : await db
        .select()
        .from(resumes)
        .where(and(eq(resumes.userId, user.clerkUserId), eq(resumes.isDefault, true)))
        .limit(1);

  const gate = await runGate({
    subject: message.subject,
    body: message.body,
    resumeText: resume?.extractedText ?? '',
    facts: contact.research ?? [],
  });

  if (gate.verdict === 'flag' && gateMode() === 'block') {
    await db
      .update(messages)
      .set({ status: 'needs_review', checkStatus: 'flag', checkIssues: gate.issues })
      .where(eq(messages.id, id));
    throw new ApiError(
      'GATE_FLAGGED',
      'The faithfulness check flagged unsupported claims. Edit the highlighted spans in Drafts, then try again.',
      422,
    );
  }
  if (gate.verdict === 'error') {
    await db
      .update(messages)
      .set({ status: 'needs_review', checkStatus: 'error' })
      .where(eq(messages.id, id));
    throw new ApiError(
      'GATE_ERROR',
      'The faithfulness check errored twice — the message is held, not sent.',
      422,
    );
  }

  // Queue (CAS-able) then send right now.
  await db
    .update(messages)
    .set({
      status: 'queued',
      checkStatus: gate.verdict === 'flag' ? 'flag' : 'pass',
      checkIssues: gate.issues.length > 0 ? gate.issues : null,
      runId: null,
      scheduledFor: new Date(),
    })
    .where(
      and(
        eq(messages.id, id),
        inArray(messages.status, ['draft', 'needs_review', 'queued', 'failed']),
      ),
    );

  const outcome = await sendOne(db, mailer, id);
  const [after] = await db.select().from(messages).where(eq(messages.id, id)).limit(1);

  if ('failed' in outcome) {
    throw new ApiError(
      after?.errorCode ?? 'SEND_FAILED',
      after?.errorMessage ?? 'The send failed.',
      502,
    );
  }
  if ('suppressed' in outcome) {
    throw new ApiError(
      'SUPPRESSED',
      'This contact is suppressed — the send was blocked at the final check.',
      409,
    );
  }
  return NextResponse.json({ message: after });
});
