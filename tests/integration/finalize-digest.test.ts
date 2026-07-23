import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeTestDb, mkUser, mkContact, mkRun, mkMessage } from '../helpers/test-db';
import type { Db } from '@/lib/db';
import { messages, runs } from '@/db/schema';
import { finalizeRun, markRunSending } from '@/lib/engine/finalize';
import { sendDigest } from '@/lib/engine/digest';
import { FakeMailSender } from '@/lib/mail/fake';

let db: Db;

beforeEach(async () => {
  db = await makeTestDb();
});

describe('finalizeRun', () => {
  it('tallies sent / failed / held and closes the run', async () => {
    const user = await mkUser(db);
    const run = await mkRun(db, user.clerkUserId, { kind: 'daily', status: 'sending' });
    const c1 = await mkContact(db, user.clerkUserId);
    const c2 = await mkContact(db, user.clerkUserId);
    const c3 = await mkContact(db, user.clerkUserId);
    await mkMessage(db, user.clerkUserId, c1.id, { runId: run.id, status: 'sent' });
    await mkMessage(db, user.clerkUserId, c2.id, { runId: run.id, status: 'failed' });
    await mkMessage(db, user.clerkUserId, c3.id, { runId: run.id, status: 'needs_review' });

    const result = await finalizeRun(db, run.id);
    expect(result).toEqual({ sent: 1, failed: 1, held: 1, status: 'done' });

    const [after] = await db.select().from(runs).where(eq(runs.id, run.id));
    expect(after?.status).toBe('done');
    expect(after?.sentCount).toBe(1);
    expect(after?.finishedAt).toBeInstanceOf(Date);
  });

  it('cancels anything still pending on a cancelled run', async () => {
    const user = await mkUser(db);
    const run = await mkRun(db, user.clerkUserId, { kind: 'manual', cancelled: true });
    const c1 = await mkContact(db, user.clerkUserId);
    const c2 = await mkContact(db, user.clerkUserId);
    await mkMessage(db, user.clerkUserId, c1.id, { runId: run.id, status: 'sent' });
    const pending = await mkMessage(db, user.clerkUserId, c2.id, {
      runId: run.id,
      status: 'queued',
    });

    const result = await finalizeRun(db, run.id);
    expect(result.status).toBe('cancelled');
    const [p] = await db.select().from(messages).where(eq(messages.id, pending.id));
    expect(p?.status).toBe('cancelled');
  });

  it('markRunSending flips the run into the sending state', async () => {
    const user = await mkUser(db);
    const run = await mkRun(db, user.clerkUserId, { kind: 'daily', status: 'waiting' });
    await markRunSending(db, run.id);
    const [after] = await db.select().from(runs).where(eq(runs.id, run.id));
    expect(after?.status).toBe('sending');
  });
});

describe('sendDigest', () => {
  it('emails the operator a summary of queued and held messages', async () => {
    const user = await mkUser(db, { email: 'operator@gmail.com' });
    const run = await mkRun(db, user.clerkUserId, { kind: 'daily', status: 'waiting' });
    const c1 = await mkContact(db, user.clerkUserId, { firstName: 'Priya', company: 'Stripe' });
    const c2 = await mkContact(db, user.clerkUserId, { firstName: 'Hana', company: 'Anthropic' });
    const m1 = await mkMessage(db, user.clerkUserId, c1.id, {
      runId: run.id,
      status: 'queued',
      subject: 'Quick note',
    });
    const m2 = await mkMessage(db, user.clerkUserId, c2.id, {
      runId: run.id,
      status: 'needs_review',
      checkStatus: 'flag',
    });

    const mailer = new FakeMailSender();
    const result = await sendDigest(db, mailer, run.id, [m1.id, m2.id]);

    expect(result).toEqual({ queued: 1, held: 1 });
    expect(mailer.outbox).toHaveLength(1);
    const digest = mailer.outbox[0]!;
    expect(digest.to).toBe('operator@gmail.com');
    expect(digest.from).toBe('operator@gmail.com'); // no GMAIL_USER set in test
    expect(digest.text).toContain('Priya');
    expect(digest.text).toContain('Hana');
    expect(digest.subject).toMatch(/1 to send/);

    const [after] = await db.select().from(runs).where(eq(runs.id, run.id));
    expect(after?.heldCount).toBe(1);
  });

  it('still sends a digest when nothing is queued', async () => {
    const user = await mkUser(db);
    const run = await mkRun(db, user.clerkUserId, { kind: 'daily' });
    const mailer = new FakeMailSender();
    const result = await sendDigest(db, mailer, run.id, []);
    expect(result).toEqual({ queued: 0, held: 0 });
    expect(mailer.outbox[0]?.text).toContain('Nothing is queued');
  });
});

describe('cancelRun closes the run out', () => {
  it('marks it cancelled AND terminal, so it cannot shadow later runs', async () => {
    const { cancelRun } = await import('@/lib/engine/contact-actions');
    const user = await mkUser(db);
    const run = await mkRun(db, user.clerkUserId, { kind: 'manual', status: 'waiting' });
    const contact = await mkContact(db, user.clerkUserId, { status: 'queued' });
    await mkMessage(db, user.clerkUserId, contact.id, { runId: run.id, status: 'queued' });

    await cancelRun(db, user.clerkUserId, run.id);

    const [after] = await db.select().from(runs).where(eq(runs.id, run.id));
    expect(after?.cancelled).toBe(true);
    // Previously this stayed 'waiting' — an active status the Queue board
    // treated as the current run, hiding newer ones behind stale rows.
    expect(after?.status).toBe('cancelled');
    expect(after?.finishedAt).toBeInstanceOf(Date);
  });
});
