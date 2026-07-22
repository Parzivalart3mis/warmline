import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '@/lib/db';
import { contacts, messages, resumes, runs, suppressions, users } from '@/db/schema';
import type { MailSender } from '@/lib/mail/sender';
import { MailSendError } from '@/lib/mail/sender';
import { rfcMessageId } from '@/lib/mail';
import { appendEvent } from './events';

export type SendOutcome =
  | { skipped: true }
  | { suppressed: true }
  | { cancelled: true }
  | { sent: true }
  | { failed: true; code: string };

/**
 * §11 — the idempotency contract. Step retries land here; the compare-and-swap
 * claim means a retry of a step that already ran returns silently. Never send
 * twice.
 */
export async function sendOne(db: Db, mailer: MailSender, messageId: string): Promise<SendOutcome> {
  // 1. CAS claim: queued → sending. 0 rows updated ⇒ someone already claimed it.
  const claimed = await db
    .update(messages)
    .set({ status: 'sending', attempts: sql`${messages.attempts} + 1` })
    .where(and(eq(messages.id, messageId), eq(messages.status, 'queued')))
    .returning();
  const message = claimed[0];
  if (!message) return { skipped: true };

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

  const cancel = async (reason: 'suppressed' | 'cancelled') => {
    await db.update(messages).set({ status: 'cancelled' }).where(eq(messages.id, messageId));
    await appendEvent(db, {
      userId: message.userId,
      type: reason,
      contactId: message.contactId,
      messageId,
      payload: { where: 'sendOne' },
    });
  };

  if (!contact || !user) {
    await cancel('cancelled');
    return { cancelled: true };
  }

  // 2. Three-way suppression re-check, immediately before the wire.
  const suppressedRow = await db
    .select()
    .from(suppressions)
    .where(and(eq(suppressions.userId, message.userId), eq(suppressions.email, contact.email)))
    .limit(1);
  if (contact.suppressed || suppressedRow.length > 0) {
    await cancel('suppressed');
    return { suppressed: true };
  }

  // 3. Run cancelled? The digest grace period exists for exactly this.
  if (message.runId) {
    const [run] = await db.select().from(runs).where(eq(runs.id, message.runId)).limit(1);
    if (run?.cancelled) {
      await cancel('cancelled');
      return { cancelled: true };
    }
  }

  const fail = async (code: string, errorMessage: string) => {
    await db
      .update(messages)
      .set({ status: 'failed', errorCode: code, errorMessage })
      .where(eq(messages.id, messageId));
    await db.update(contacts).set({ status: 'failed' }).where(eq(contacts.id, contact.id));
    // Log the SMTP error code, never the payload.
    await appendEvent(db, {
      userId: message.userId,
      type: 'failed',
      contactId: contact.id,
      messageId,
      payload: { code },
    });
  };

  // Send from GMAIL_USER (the authenticated SMTP mailbox), falling back to the
  // operator's account email when it isn't set.
  const fromAddress = process.env.GMAIL_USER ?? user.email;

  // 4. Our own deterministic RFC Message-ID, set BEFORE the send — if a retry
  // ever slips through, Gmail sees the same Message-ID and threads, not dupes.
  const rfcId = message.rfcMessageId ?? rfcMessageId(message.id);
  await db.update(messages).set({ rfcMessageId: rfcId }).where(eq(messages.id, messageId));

  // Attach the exact version this draft was written from, so the email's
  // claims and its attachment can never diverge. Older messages predating
  // that pin fall back to the contact's pick, then the user default.
  const resumeId = message.resumeId ?? contact.resumeId ?? user.defaultResumeId;
  const [resume] = resumeId
    ? await db.select().from(resumes).where(eq(resumes.id, resumeId)).limit(1)
    : await db
        .select()
        .from(resumes)
        .where(and(eq(resumes.userId, user.clerkUserId), eq(resumes.isDefault, true)))
        .limit(1);

  await appendEvent(db, {
    userId: message.userId,
    type: 'sending',
    contactId: contact.id,
    messageId,
  });

  try {
    // 5. The wire.
    await mailer.send({
      from: fromAddress,
      to: contact.email,
      subject: message.subject,
      text: message.body,
      messageId: rfcId,
      ...(message.inReplyTo ? { inReplyTo: message.inReplyTo } : {}),
      ...(message.references ? { references: message.references } : {}),
      ...(resume ? { attachments: [{ filename: resume.fileName, path: resume.blobUrl }] } : {}),
    });

    // 6. Success.
    await db
      .update(messages)
      .set({ status: 'sent', sentAt: new Date() })
      .where(eq(messages.id, messageId));
    await db.update(contacts).set({ status: 'sent' }).where(eq(contacts.id, contact.id));
    await appendEvent(db, {
      userId: message.userId,
      type: 'sent',
      contactId: contact.id,
      messageId,
      payload: { step: message.step },
    });
    return { sent: true };
  } catch (err) {
    // 7. Failure.
    const code = err instanceof MailSendError ? err.code : 'SEND_ERROR';
    const msg =
      err instanceof MailSendError
        ? err.message
        : 'The send failed before Gmail accepted it. Check the server logs.';
    await fail(code, msg);
    return { failed: true, code };
  }
}
