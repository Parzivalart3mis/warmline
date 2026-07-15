import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeTestDb, mkUser, mkContact, mkResume, mkRun } from '../helpers/test-db';
import { draftModelMock, passGateModel, flagGateModel } from '../helpers/mock-model';
import type { Db } from '@/lib/db';
import { contacts, messages, runs, users } from '@/db/schema';
import { runInline } from '@/lib/engine/run-inline';
import { FakeMailSender } from '@/lib/mail/fake';

let db: Db;

beforeEach(async () => {
  db = await makeTestDb();
});

/**
 * Drives the whole §11 pipeline offline with mock models: plan → prepare
 * (draft + gate) → digest → drip → finalize. This is the same sequence the
 * durable workflow runs, minus the sleeps.
 */
describe('runInline — full pipeline with mocked models', () => {
  async function seed(count: number) {
    const user = await mkUser(db, { jitterSeconds: 0, intervalSeconds: 120 });
    const resume = await mkResume(db, user.clerkUserId, { isDefault: true });
    await db
      .update(users)
      .set({ defaultResumeId: resume.id })
      .where(eq(users.clerkUserId, user.clerkUserId));
    for (let i = 0; i < count; i++) {
      await mkContact(db, user.clerkUserId, { researchOptIn: false, company: '' });
    }
    return user;
  }

  it('drafts, gates, digests, drips, and finalizes a clean run', async () => {
    const user = await seed(3);
    const run = await mkRun(db, user.clerkUserId, { kind: 'manual' });
    const mailer = new FakeMailSender();

    await runInline(db, mailer, run.id, {
      maxSleepMs: 1,
      prepareDeps: {
        draftModel: draftModelMock('Hi there', 'A short note.\n\nYash'),
        gateModel: passGateModel(),
      },
    });

    // Digest (1) + three sent emails (3) = 4 in the outbox.
    expect(mailer.outbox).toHaveLength(4);
    const sent = await db.select().from(messages).where(eq(messages.status, 'sent'));
    expect(sent).toHaveLength(3);
    for (const m of sent) {
      expect(m.rfcMessageId).toBe(`<${m.id}@warmline.app>`);
      expect(m.subject).toBe('Hi there');
    }
    const [after] = await db.select().from(runs).where(eq(runs.id, run.id));
    expect(after?.status).toBe('done');
    expect(after?.sentCount).toBe(3);
  });

  it('holds gate-flagged drafts: they are digested but never sent', async () => {
    const user = await seed(2);
    const run = await mkRun(db, user.clerkUserId, { kind: 'manual' });
    const mailer = new FakeMailSender();

    await runInline(db, mailer, run.id, {
      maxSleepMs: 1,
      prepareDeps: {
        draftModel: draftModelMock(),
        gateModel: flagGateModel('we met at a conference'),
      },
    });

    const held = await db.select().from(messages).where(eq(messages.status, 'needs_review'));
    expect(held).toHaveLength(2);
    const sent = await db.select().from(messages).where(eq(messages.status, 'sent'));
    expect(sent).toHaveLength(0);

    // Only the digest went out — no drafts.
    expect(mailer.outbox).toHaveLength(1);
    expect(mailer.outbox[0]?.text).toMatch(/will NOT send/i);

    const [after] = await db.select().from(runs).where(eq(runs.id, run.id));
    expect(after?.heldCount).toBe(2);
  });

  it('finalizes immediately when nothing is eligible', async () => {
    const user = await mkUser(db);
    const run = await mkRun(db, user.clerkUserId, { kind: 'manual' });
    const mailer = new FakeMailSender();
    await runInline(db, mailer, run.id, { maxSleepMs: 1 });
    expect(mailer.outbox).toHaveLength(0);
    const [after] = await db.select().from(runs).where(eq(runs.id, run.id));
    expect(after?.status).toBe('done');
  });

  it('respects suppression through the whole pipeline', async () => {
    const user = await seed(1);
    await mkContact(db, user.clerkUserId, { suppressed: true, researchOptIn: false, company: '' });
    const run = await mkRun(db, user.clerkUserId, { kind: 'manual' });
    const mailer = new FakeMailSender();

    await runInline(db, mailer, run.id, {
      maxSleepMs: 1,
      prepareDeps: { draftModel: draftModelMock(), gateModel: passGateModel() },
    });

    // Only the one non-suppressed contact is emailed (plus the digest).
    const sent = await db.select().from(messages).where(eq(messages.status, 'sent'));
    expect(sent).toHaveLength(1);
    const suppressed = await db.select().from(contacts).where(eq(contacts.suppressed, true));
    expect(suppressed).toHaveLength(1);
  });
});
