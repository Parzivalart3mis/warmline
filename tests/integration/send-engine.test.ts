import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeTestDb, mkUser, mkContact, mkResume, mkRun, mkMessage } from '../helpers/test-db';
import { passGateModel, flagGateModel, draftModelMock, jsonModel } from '../helpers/mock-model';
import type { Db } from '@/lib/db';
import { contacts, messages, suppressions } from '@/db/schema';
import { sendOne } from '@/lib/engine/send-one';
import { prepareOne } from '@/lib/engine/prepare';
import { reconcileStuckSending } from '@/lib/engine/reconcile';
import { markReplied, suppressContact, cancelRun } from '@/lib/engine/contact-actions';
import { FakeMailSender } from '@/lib/mail/fake';
import { MailSendError, type MailSender } from '@/lib/mail/sender';

let db: Db;

beforeEach(async () => {
  db = await makeTestDb();
});

describe('sendOne — the idempotency contract', () => {
  it('fires exactly one send when invoked twice concurrently', async () => {
    const user = await mkUser(db);
    const contact = await mkContact(db, user.clerkUserId);
    const message = await mkMessage(db, user.clerkUserId, contact.id, { status: 'queued' });
    const mailer = new FakeMailSender();

    const [a, b] = await Promise.all([
      sendOne(db, mailer, message.id),
      sendOne(db, mailer, message.id),
    ]);

    expect(mailer.outbox).toHaveLength(1);
    const outcomes = [a, b];
    expect(outcomes.filter((o) => 'sent' in o)).toHaveLength(1);
    expect(outcomes.filter((o) => 'skipped' in o)).toHaveLength(1);

    const [after] = await db.select().from(messages).where(eq(messages.id, message.id));
    expect(after?.status).toBe('sent');
    expect(after?.sentAt).toBeInstanceOf(Date);
    expect(after?.rfcMessageId).toBe(`<${message.id}@warmline.app>`);
    expect(after?.attempts).toBe(1);
  });

  it('is a no-op for anything not queued', async () => {
    const user = await mkUser(db);
    const contact = await mkContact(db, user.clerkUserId);
    const mailer = new FakeMailSender();
    for (const status of ['draft', 'needs_review', 'sent', 'failed', 'cancelled'] as const) {
      const c = await mkContact(db, user.clerkUserId);
      const m = await mkMessage(db, user.clerkUserId, c.id, { status });
      expect(await sendOne(db, mailer, m.id)).toEqual({ skipped: true });
    }
    expect(mailer.outbox).toHaveLength(0);
    void contact;
  });

  it('threads follow-ups with in-reply-to and references headers', async () => {
    const user = await mkUser(db);
    const contact = await mkContact(db, user.clerkUserId);
    const message = await mkMessage(db, user.clerkUserId, contact.id, {
      status: 'queued',
      step: 2,
      subject: 'Re: Original',
      inReplyTo: '<parent@warmline.app>',
      references: '<parent@warmline.app>',
    });
    const mailer = new FakeMailSender();
    await sendOne(db, mailer, message.id);

    expect(mailer.outbox[0]?.inReplyTo).toBe('<parent@warmline.app>');
    expect(mailer.outbox[0]?.references).toBe('<parent@warmline.app>');
    expect(mailer.outbox[0]?.subject).toBe('Re: Original');
  });

  it('attaches the resume', async () => {
    const user = await mkUser(db);
    const resume = await mkResume(db, user.clerkUserId, { isDefault: true });
    await db
      .update((await import('@/db/schema')).users)
      .set({ defaultResumeId: resume.id })
      .where(eq((await import('@/db/schema')).users.clerkUserId, user.clerkUserId));
    const contact = await mkContact(db, user.clerkUserId);
    const message = await mkMessage(db, user.clerkUserId, contact.id, { status: 'queued' });
    const mailer = new FakeMailSender();
    await sendOne(db, mailer, message.id);
    expect(mailer.outbox[0]?.attachments?.[0]?.filename).toBe(resume.fileName);
  });

  it('marks message and contact failed on SMTP failure, logging only the code', async () => {
    const user = await mkUser(db);
    const contact = await mkContact(db, user.clerkUserId);
    const message = await mkMessage(db, user.clerkUserId, contact.id, { status: 'queued' });
    const failing: MailSender = {
      kind: 'fake',
      send: async () => {
        throw new MailSendError('SMTP_550', 'Recipient address rejected');
      },
    };
    const outcome = await sendOne(db, failing, message.id);
    expect(outcome).toEqual({ failed: true, code: 'SMTP_550' });

    const [m] = await db.select().from(messages).where(eq(messages.id, message.id));
    expect(m?.status).toBe('failed');
    expect(m?.errorCode).toBe('SMTP_550');
    const [c] = await db.select().from(contacts).where(eq(contacts.id, contact.id));
    expect(c?.status).toBe('failed');
  });

  it('refuses to send as a different identity than the signed-in account', async () => {
    const prev = process.env.GMAIL_USER;
    process.env.GMAIL_USER = 'someone-else@gmail.com';
    try {
      const user = await mkUser(db, { email: 'operator@gmail.com' });
      const contact = await mkContact(db, user.clerkUserId);
      const message = await mkMessage(db, user.clerkUserId, contact.id, { status: 'queued' });
      const realish: MailSender = {
        kind: 'real',
        send: async () => ({ messageId: 'x', response: 'ok' }),
      };
      const outcome = await sendOne(db, realish, message.id);
      expect(outcome).toEqual({ failed: true, code: 'IDENTITY_MISMATCH' });
    } finally {
      if (prev === undefined) delete process.env.GMAIL_USER;
      else process.env.GMAIL_USER = prev;
    }
  });
});

describe('suppression — three independent checkpoints', () => {
  it('sendOne re-checks the suppression list immediately before the wire', async () => {
    const user = await mkUser(db);
    const contact = await mkContact(db, user.clerkUserId, { email: 'stop@example.com' });
    const message = await mkMessage(db, user.clerkUserId, contact.id, { status: 'queued' });
    // Suppression arrives AFTER queueing (the race the re-check exists for).
    await db.insert(suppressions).values({ userId: user.clerkUserId, email: 'STOP@example.com' });

    const mailer = new FakeMailSender();
    const outcome = await sendOne(db, mailer, message.id);
    expect(outcome).toEqual({ suppressed: true });
    expect(mailer.outbox).toHaveLength(0);
    const [m] = await db.select().from(messages).where(eq(messages.id, message.id));
    expect(m?.status).toBe('cancelled');
  });

  it('sendOne honors the contact-level suppressed flag too', async () => {
    const user = await mkUser(db);
    const contact = await mkContact(db, user.clerkUserId, { suppressed: true });
    const message = await mkMessage(db, user.clerkUserId, contact.id, { status: 'queued' });
    const mailer = new FakeMailSender();
    expect(await sendOne(db, mailer, message.id)).toEqual({ suppressed: true });
    expect(mailer.outbox).toHaveLength(0);
  });

  it('prepareOne cancels drafts for contacts suppressed after planning', async () => {
    const user = await mkUser(db);
    const contact = await mkContact(db, user.clerkUserId, { suppressed: true });
    const message = await mkMessage(db, user.clerkUserId, contact.id, {
      status: 'draft',
      body: '',
    });
    const result = await prepareOne(db, message.id, {
      draftModel: draftModelMock(),
      gateModel: passGateModel(),
    });
    expect(result.outcome).toBe('cancelled');
  });
});

describe('run cancellation', () => {
  it('sendOne drops the send when the run was cancelled during the grace period', async () => {
    const user = await mkUser(db);
    const run = await mkRun(db, user.clerkUserId, { cancelled: true });
    const contact = await mkContact(db, user.clerkUserId);
    const message = await mkMessage(db, user.clerkUserId, contact.id, {
      status: 'queued',
      runId: run.id,
    });
    const mailer = new FakeMailSender();
    expect(await sendOne(db, mailer, message.id)).toEqual({ cancelled: true });
    expect(mailer.outbox).toHaveLength(0);
  });

  it('cancelRun reverts queued contacts to not_sent unless they were ever sent', async () => {
    const user = await mkUser(db);
    const run = await mkRun(db, user.clerkUserId);
    const fresh = await mkContact(db, user.clerkUserId, { status: 'queued' });
    await mkMessage(db, user.clerkUserId, fresh.id, { status: 'queued', runId: run.id });

    const veteran = await mkContact(db, user.clerkUserId, { status: 'queued' });
    await mkMessage(db, user.clerkUserId, veteran.id, {
      status: 'sent',
      step: 1,
      sentAt: new Date(),
    });
    await mkMessage(db, user.clerkUserId, veteran.id, { status: 'queued', step: 2, runId: run.id });

    await cancelRun(db, user.clerkUserId, run.id);

    const [f] = await db.select().from(contacts).where(eq(contacts.id, fresh.id));
    const [v] = await db.select().from(contacts).where(eq(contacts.id, veteran.id));
    expect(f?.status).toBe('not_sent');
    expect(v?.status).toBe('sent');
  });
});

describe('prepareOne — research → draft → gate', () => {
  it('queues a passing draft and records generation', async () => {
    const user = await mkUser(db);
    await mkResume(db, user.clerkUserId, { isDefault: true });
    const contact = await mkContact(db, user.clerkUserId, { researchOptIn: false });
    const message = await mkMessage(db, user.clerkUserId, contact.id, {
      status: 'draft',
      subject: '',
      body: '',
    });

    const result = await prepareOne(db, message.id, {
      draftModel: draftModelMock('Custom subject', 'Custom body'),
      gateModel: passGateModel(),
    });
    expect(result.outcome).toBe('queued');

    const [m] = await db.select().from(messages).where(eq(messages.id, message.id));
    expect(m?.status).toBe('queued');
    expect(m?.subject).toBe('Custom subject');
    expect(m?.checkStatus).toBe('pass');
  });

  it('holds a flagged draft as needs_review — it will NOT send', async () => {
    const user = await mkUser(db);
    await mkResume(db, user.clerkUserId, { isDefault: true });
    const contact = await mkContact(db, user.clerkUserId, { researchOptIn: false });
    const message = await mkMessage(db, user.clerkUserId, contact.id, {
      status: 'draft',
      body: '',
    });

    const result = await prepareOne(db, message.id, {
      draftModel: draftModelMock(),
      gateModel: flagGateModel('we shared an office at CERN'),
    });
    expect(result.outcome).toBe('needs_review');

    const [m] = await db.select().from(messages).where(eq(messages.id, message.id));
    expect(m?.status).toBe('needs_review');
    expect(m?.checkStatus).toBe('flag');
    expect(m?.checkIssues?.[0]?.span).toBe('we shared an office at CERN');

    // …and the drip skips it: sendOne only claims 'queued'.
    const mailer = new FakeMailSender();
    expect(await sendOne(db, mailer, message.id)).toEqual({ skipped: true });
  });

  it('holds the message when the gate errors twice (fail closed)', async () => {
    const user = await mkUser(db);
    await mkResume(db, user.clerkUserId, { isDefault: true });
    const contact = await mkContact(db, user.clerkUserId, { researchOptIn: false });
    const message = await mkMessage(db, user.clerkUserId, contact.id, {
      status: 'draft',
      body: '',
    });

    const result = await prepareOne(db, message.id, {
      draftModel: draftModelMock(),
      gateModel: jsonModel('this is not the schema you are looking for'),
    });
    expect(result.outcome).toBe('needs_review');
    const [m] = await db.select().from(messages).where(eq(messages.id, message.id));
    expect(m?.checkStatus).toBe('error');
  });

  it('does not regenerate an edited held draft — only re-gates it', async () => {
    const user = await mkUser(db);
    await mkResume(db, user.clerkUserId, { isDefault: true });
    const contact = await mkContact(db, user.clerkUserId, { researchOptIn: false });
    const message = await mkMessage(db, user.clerkUserId, contact.id, {
      status: 'draft',
      subject: 'Hand-edited subject',
      body: 'Hand-edited body that must survive.',
    });

    await prepareOne(db, message.id, {
      draftModel: draftModelMock('SHOULD NOT APPEAR', 'SHOULD NOT APPEAR'),
      gateModel: passGateModel(),
    });
    const [m] = await db.select().from(messages).where(eq(messages.id, message.id));
    expect(m?.body).toBe('Hand-edited body that must survive.');
    expect(m?.status).toBe('queued');
  });

  it('is idempotent on step retry', async () => {
    const user = await mkUser(db);
    await mkResume(db, user.clerkUserId, { isDefault: true });
    const contact = await mkContact(db, user.clerkUserId, { researchOptIn: false });
    const message = await mkMessage(db, user.clerkUserId, contact.id, {
      status: 'draft',
      body: '',
    });
    const deps = { draftModel: draftModelMock(), gateModel: passGateModel() };
    await prepareOne(db, message.id, deps);
    const again = await prepareOne(db, message.id, deps);
    expect(again.outcome).toBe('queued');
  });
});

describe('replies and follow-ups', () => {
  it('marking replied cancels pending follow-ups permanently', async () => {
    const user = await mkUser(db);
    const contact = await mkContact(db, user.clerkUserId, { status: 'sent' });
    await mkMessage(db, user.clerkUserId, contact.id, {
      status: 'sent',
      step: 1,
      sentAt: new Date(),
    });
    const pending = await mkMessage(db, user.clerkUserId, contact.id, {
      status: 'queued',
      step: 2,
    });

    const updated = await markReplied(db, user.clerkUserId, contact.id);
    expect(updated?.status).toBe('replied');
    expect(updated?.repliedAt).toBeInstanceOf(Date);

    const [p] = await db.select().from(messages).where(eq(messages.id, pending.id));
    expect(p?.status).toBe('cancelled');

    const mailer = new FakeMailSender();
    expect(await sendOne(db, mailer, pending.id)).toEqual({ skipped: true });
  });

  it('suppressContact adds the list entry and cancels pending mail', async () => {
    const user = await mkUser(db);
    const contact = await mkContact(db, user.clerkUserId, { email: 'nomore@example.com' });
    const pending = await mkMessage(db, user.clerkUserId, contact.id, { status: 'queued' });

    await suppressContact(db, user.clerkUserId, contact.id, 'asked to stop');

    const list = await db.select().from(suppressions);
    expect(list).toHaveLength(1);
    expect(list[0]?.email).toBe('nomore@example.com');
    const [p] = await db.select().from(messages).where(eq(messages.id, pending.id));
    expect(p?.status).toBe('cancelled');
    const [c] = await db.select().from(contacts).where(eq(contacts.id, contact.id));
    expect(c?.suppressed).toBe(true);
    expect(c?.status).toBe('suppressed');
  });
});

describe('stuck-sending reconciliation', () => {
  it('moves >5min sending messages to needs_review, never auto-retries', async () => {
    const user = await mkUser(db);
    const contact = await mkContact(db, user.clerkUserId);
    const stale = await mkMessage(db, user.clerkUserId, contact.id, {
      status: 'sending',
      updatedAt: new Date(Date.now() - 6 * 60_000),
    });
    const freshMsg = await mkMessage(
      db,
      user.clerkUserId,
      (await mkContact(db, user.clerkUserId)).id,
      {
        status: 'sending',
        updatedAt: new Date(),
      },
    );

    const n = await reconcileStuckSending(db);
    expect(n).toBe(1);

    const [s] = await db.select().from(messages).where(eq(messages.id, stale.id));
    expect(s?.status).toBe('needs_review');
    expect(s?.errorCode).toBe('STUCK_SENDING');
    const [f] = await db.select().from(messages).where(eq(messages.id, freshMsg.id));
    expect(f?.status).toBe('sending');
  });
});
