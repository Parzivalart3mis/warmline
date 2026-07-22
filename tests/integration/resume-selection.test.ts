import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeTestDb, mkUser, mkContact, mkResume, mkMessage } from '../helpers/test-db';
import { jsonModel, draftModelMock, passGateModel } from '../helpers/mock-model';
import type { Db } from '@/lib/db';
import { messages, users } from '@/db/schema';
import { resolveResumeForDraft } from '@/lib/engine/resolve-resume';
import { prepareOne } from '@/lib/engine/prepare';
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
