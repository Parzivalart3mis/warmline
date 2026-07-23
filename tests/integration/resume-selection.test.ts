import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeTestDb, mkUser, mkContact, mkResume, mkMessage } from '../helpers/test-db';
import { jsonModel, draftModelMock, passGateModel } from '../helpers/mock-model';
import type { Db } from '@/lib/db';
import { messages, users } from '@/db/schema';
import { resolveResumeForDraft } from '@/lib/engine/resolve-resume';
import { prepareOne, prepareContext, prepareDraft, prepareGate } from '@/lib/engine/prepare';
import { sendOne } from '@/lib/engine/send-one';
import { FakeMailSender } from '@/lib/mail/fake';

let db: Db;

beforeEach(async () => {
  db = await makeTestDb();
});

/** A user with Backend (default) + ML versions. */
async function seedTwoResumes(overrides: { autoSelectResume?: boolean } = {}) {
  const user = await mkUser(db, overrides);
  const backend = await mkResume(db, user.clerkUserId, {
    label: 'Backend',
    isDefault: true,
    extractedText: 'Go, Postgres, Kafka.',
  });
  const ml = await mkResume(db, user.clerkUserId, {
    label: 'ML',
    extractedText: 'PyTorch, transformers.',
  });
  await db
    .update(users)
    .set({ defaultResumeId: backend.id })
    .where(eq(users.clerkUserId, user.clerkUserId));
  const fresh = (await db.select().from(users).where(eq(users.clerkUserId, user.clerkUserId)))[0]!;
  return { user: fresh, backend, ml };
}

describe('resolveResumeForDraft — precedence', () => {
  it('1. an explicit contact choice always wins, even over a confident AI pick', async () => {
    const { user, backend, ml } = await seedTwoResumes();
    const contact = await mkContact(db, user.clerkUserId, {
      resumeId: backend.id,
      targetRole: 'ML Engineer', // signal that would otherwise pick ML
    });

    const choice = await resolveResumeForDraft(
      db,
      { user, contact },
      { selectModel: jsonModel({ resumeLabel: 'ML' }) },
    );
    expect(choice.via).toBe('explicit');
    expect(choice.resume?.id).toBe(backend.id);
    expect(choice.resume?.id).not.toBe(ml.id);
  });

  it('2. AI picks when there is no explicit choice and there is signal', async () => {
    const { user, ml } = await seedTwoResumes();
    const contact = await mkContact(db, user.clerkUserId, { targetRole: 'ML Engineer' });

    const choice = await resolveResumeForDraft(
      db,
      { user, contact },
      { selectModel: jsonModel({ resumeLabel: 'ML', reason: 'ML-heavy role.' }) },
    );
    expect(choice.via).toBe('ai');
    expect(choice.resume?.id).toBe(ml.id);
    expect(choice.reason).toContain('ML-heavy');
  });

  it('3. falls back to the default when the toggle is off', async () => {
    const { user, backend } = await seedTwoResumes({ autoSelectResume: false });
    const contact = await mkContact(db, user.clerkUserId, { targetRole: 'ML Engineer' });

    const choice = await resolveResumeForDraft(
      db,
      { user, contact },
      { selectModel: jsonModel({ resumeLabel: 'ML' }) },
    );
    expect(choice.via).toBe('default');
    expect(choice.resume?.id).toBe(backend.id);
  });

  it('3. falls back to the default when there is no signal', async () => {
    const { user, backend } = await seedTwoResumes();
    const contact = await mkContact(db, user.clerkUserId, { targetRole: '' });

    const choice = await resolveResumeForDraft(db, { user, contact });
    expect(choice.via).toBe('default');
    expect(choice.resume?.id).toBe(backend.id);
  });

  it('3. fails open to the default when the selector errors', async () => {
    const { user, backend } = await seedTwoResumes();
    const contact = await mkContact(db, user.clerkUserId, { targetRole: 'ML Engineer' });

    const choice = await resolveResumeForDraft(
      db,
      { user, contact },
      { selectModel: jsonModel({ resumeLabel: 'Nonexistent' }) },
    );
    expect(choice.via).toBe('default');
    expect(choice.resume?.id).toBe(backend.id);
  });

  it('reports none when the user has no resumes at all', async () => {
    const user = await mkUser(db);
    const contact = await mkContact(db, user.clerkUserId, { targetRole: 'Backend Engineer' });
    const choice = await resolveResumeForDraft(db, { user, contact });
    expect(choice).toEqual({ resume: null, via: 'none' });
  });
});

describe('the chosen resume is pinned end to end', () => {
  it('prepareOne records the resume, and sendOne attaches that exact version', async () => {
    const { user, ml } = await seedTwoResumes();
    const contact = await mkContact(db, user.clerkUserId, {
      targetRole: 'ML Engineer',
      researchOptIn: false,
      company: '',
    });
    const message = await mkMessage(db, user.clerkUserId, contact.id, {
      status: 'draft',
      body: '',
    });

    await prepareOne(db, message.id, {
      draftModel: draftModelMock(),
      gateModel: passGateModel(),
      selectModel: jsonModel({ resumeLabel: 'ML' }),
    });

    const [prepared] = await db.select().from(messages).where(eq(messages.id, message.id));
    expect(prepared?.resumeId).toBe(ml.id);
    expect(prepared?.status).toBe('queued');

    const mailer = new FakeMailSender();
    await sendOne(db, mailer, message.id);
    expect(mailer.outbox[0]?.attachments?.[0]?.filename).toBe(ml.fileName);
  });

  it("sendOne still works for older messages with no pinned resume", async () => {
    const { user, backend } = await seedTwoResumes();
    const contact = await mkContact(db, user.clerkUserId);
    const message = await mkMessage(db, user.clerkUserId, contact.id, { status: 'queued' });

    const mailer = new FakeMailSender();
    await sendOne(db, mailer, message.id);
    expect(mailer.outbox[0]?.attachments?.[0]?.filename).toBe(backend.fileName);
  });
});

describe('prepare split into workflow-sized steps', () => {
  it('context → draft → gate produces the same result as the composed prepareOne', async () => {
    const { user, ml } = await seedTwoResumes();
    const contact = await mkContact(db, user.clerkUserId, {
      targetRole: 'ML Engineer',
      researchOptIn: false,
      company: '',
    });
    const message = await mkMessage(db, user.clerkUserId, contact.id, {
      status: 'draft',
      body: '',
    });

    const deps = {
      draftModel: draftModelMock('Split subject', 'Split body.'),
      gateModel: passGateModel(),
      selectModel: jsonModel({ resumeLabel: 'ML' }),
    };

    // Drive the three steps exactly as the durable workflow does — passing
    // only the message id, never a payload.
    const ctx = await prepareContext(db, message.id, deps);
    expect(ctx.ready).toBe(true);
    await prepareDraft(db, message.id, deps);
    const { outcome } = await prepareGate(db, message.id, deps);

    expect(outcome).toBe('queued');
    const [after] = await db.select().from(messages).where(eq(messages.id, message.id));
    expect(after?.status).toBe('queued');
    expect(after?.subject).toBe('Split subject');
    expect(after?.resumeId).toBe(ml.id); // resume pinned by the context step
  });

  it('keeps the value passed between steps tiny (workflow state stays small)', async () => {
    const { user } = await seedTwoResumes();
    const contact = await mkContact(db, user.clerkUserId, {
      targetRole: 'ML Engineer',
      researchOptIn: false,
      company: '',
    });
    const message = await mkMessage(db, user.clerkUserId, contact.id, {
      status: 'draft',
      body: '',
    });

    const ctx = await prepareContext(db, message.id, {
      selectModel: jsonModel({ resumeLabel: 'ML' }),
    });
    // Durable workflows persist every step argument/result for replay, so a
    // fat context here compounds until the run collapses. Guard the shape.
    const bytes = Buffer.byteLength(JSON.stringify(ctx));
    expect(bytes).toBeLessThan(200);
    expect(Object.keys(ctx).sort()).toEqual(['ready']);
  });

  it('stops after the context step when the contact is suppressed', async () => {
    const { user } = await seedTwoResumes();
    const contact = await mkContact(db, user.clerkUserId, { suppressed: true });
    const message = await mkMessage(db, user.clerkUserId, contact.id, {
      status: 'draft',
      body: '',
    });

    const ctx = await prepareContext(db, message.id);
    expect(ctx).toEqual({ ready: false, outcome: 'cancelled' });

    // Later steps are no-ops once the message is cancelled — nothing drafts.
    await prepareDraft(db, message.id);
    const { outcome } = await prepareGate(db, message.id);
    expect(outcome).toBe('cancelled');
    const [after] = await db.select().from(messages).where(eq(messages.id, message.id));
    expect(after?.status).toBe('cancelled');
    expect(after?.body).toBe('');
  });
});
