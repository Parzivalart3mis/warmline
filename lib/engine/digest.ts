import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '@/lib/db';
import { contacts, messages, resumes, runs, users } from '@/db/schema';
import type { MailSender } from '@/lib/mail/sender';
import { rfcMessageId } from '@/lib/mail';
import { createId } from '@paralleldrive/cuid2';

/**
 * §11 step 4 — the digest: an email to the operator listing exactly what is
 * about to go out, with the 10-minute grace period to cancel from the app.
 */
export function buildDigestText(input: {
  queued: Array<{
    name: string;
    company: string;
    subject: string;
    step: number;
    resume?: string | null;
  }>;
  held: Array<{ name: string; company: string; reason: string }>;
  graceMinutes: number;
}): string {
  const lines: string[] = [];
  lines.push(
    `Warmline is about to send ${input.queued.length} email${input.queued.length === 1 ? '' : 's'}.`,
  );
  lines.push(
    `Sending begins in ${input.graceMinutes} minutes. To stop it: open Warmline → Queue → Cancel today's run.`,
  );
  lines.push('');

  if (input.queued.length > 0) {
    lines.push('Going out:');
    input.queued.forEach((q, i) => {
      const stepNote = q.step > 1 ? ` (follow-up ${q.step - 1})` : '';
      lines.push(`  ${i + 1}. ${q.name} — ${q.company}${stepNote}`);
      lines.push(`     ${q.subject}`);
      if (q.resume) lines.push(`     resume: ${q.resume}`);
    });
    lines.push('');
  } else {
    lines.push('Nothing is queued to send.');
    lines.push('');
  }

  if (input.held.length > 0) {
    lines.push('Held for your review (will NOT send):');
    for (const h of input.held) {
      lines.push(`  · ${h.name} — ${h.company}: ${h.reason}`);
    }
    lines.push('');
    lines.push('Held drafts are in the Drafts tab.');
  }

  return lines.join('\n');
}

export async function sendDigest(
  db: Db,
  mailer: MailSender,
  runId: string,
  messageIds: string[],
  graceMinutes = 10,
): Promise<{ queued: number; held: number }> {
  const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  if (!run) return { queued: 0, held: 0 };
  const [user] = await db.select().from(users).where(eq(users.clerkUserId, run.userId)).limit(1);
  if (!user) return { queued: 0, held: 0 };

  const rows =
    messageIds.length > 0
      ? await db
          .select({
            id: messages.id,
            status: messages.status,
            subject: messages.subject,
            step: messages.step,
            checkStatus: messages.checkStatus,
            firstName: contacts.firstName,
            lastName: contacts.lastName,
            company: contacts.company,
            resumeLabel: resumes.label,
          })
          .from(messages)
          .innerJoin(contacts, eq(messages.contactId, contacts.id))
          .leftJoin(resumes, eq(messages.resumeId, resumes.id))
          .where(and(inArray(messages.id, messageIds), eq(messages.userId, run.userId)))
      : [];

  const name = (r: (typeof rows)[number]) => `${r.firstName} ${r.lastName}`.trim();
  const queued = rows
    .filter((r) => r.status === 'queued')
    .map((r) => ({
      name: name(r),
      company: r.company,
      subject: r.subject,
      step: r.step,
      resume: r.resumeLabel,
    }));
  const held = rows
    .filter((r) => r.status === 'needs_review')
    .map((r) => ({
      name: name(r),
      company: r.company,
      reason:
        r.checkStatus === 'error'
          ? 'the faithfulness check errored — held'
          : 'the faithfulness check flagged unsupported claims',
    }));

  const text = buildDigestText({ queued, held, graceMinutes });
  const from = process.env.GMAIL_USER ?? user.email;
  await mailer.send({
    from,
    to: user.email,
    subject: `Warmline digest — ${queued.length} to send${held.length ? `, ${held.length} held` : ''}`,
    text,
    messageId: rfcMessageId(`digest-${runId}-${createId()}`),
  });

  await db.update(runs).set({ heldCount: held.length }).where(eq(runs.id, runId));
  return { queued: queued.length, held: held.length };
}
