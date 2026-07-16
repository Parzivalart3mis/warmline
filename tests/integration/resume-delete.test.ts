import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeTestDb, mkUser, mkResume, mkContact } from '../helpers/test-db';
import type { Db } from '@/lib/db';
import { contacts, resumes, users } from '@/db/schema';

/**
 * DELETE /api/resumes/[id] — driven through the real route handler with auth,
 * DB, blob, and rate-limit mocked. Proves ownership scoping, default
 * promotion, and that contacts fall back to null.
 */
let currentUser = 'user_A';
let db: Db;
const delCalls: string[] = [];

vi.mock('@/lib/db', () => ({ getDb: async () => db }));
vi.mock('@/lib/ratelimit', () => ({ assertRateLimit: async () => {} }));
vi.mock('@vercel/blob', () => ({
  del: async (url: string) => {
    delCalls.push(url);
  },
}));
vi.mock('@/lib/auth', async () => {
  const schema = await import('@/db/schema');
  return {
    requireUserRecord: async () => {
      const [row] = await db.select().from(schema.users).where(eq(schema.users.clerkUserId, currentUser));
      if (!row) throw new Error('no user');
      return row;
    },
  };
});

beforeEach(async () => {
  db = await makeTestDb();
  currentUser = 'user_A';
  delCalls.length = 0;
  process.env.BLOB_READ_WRITE_TOKEN = 'test-token';
});

async function callDelete(id: string) {
  const { DELETE } = await import('@/app/api/resumes/[id]/route');
  return DELETE(new Request('http://t', { method: 'DELETE' }), {
    params: Promise.resolve({ id }),
  });
}

describe('DELETE /api/resumes/[id]', () => {
  it('deletes a non-default resume and nulls out referencing contacts', async () => {
    const user = await mkUser(db, { clerkUserId: 'user_A' });
    const def = await mkResume(db, user.clerkUserId, { label: 'Default', isDefault: true });
    await db.update(users).set({ defaultResumeId: def.id }).where(eq(users.clerkUserId, user.clerkUserId));
    const extra = await mkResume(db, user.clerkUserId, { label: 'Extra' });
    const contact = await mkContact(db, user.clerkUserId, { resumeId: extra.id });

    const res = await callDelete(extra.id);
    expect(res.status).toBe(200);

    const remaining = await db.select().from(resumes).where(eq(resumes.userId, user.clerkUserId));
    expect(remaining.map((r) => r.id)).toEqual([def.id]);
    const [c] = await db.select().from(contacts).where(eq(contacts.id, contact.id));
    expect(c?.resumeId).toBeNull();
    expect(delCalls).toContain(extra.blobUrl);
  });

  it('promotes the newest remaining resume when the default is deleted', async () => {
    const user = await mkUser(db, { clerkUserId: 'user_A' });
    const older = await mkResume(db, user.clerkUserId, {
      label: 'Older',
      createdAt: new Date(Date.now() - 60_000),
    });
    const def = await mkResume(db, user.clerkUserId, { label: 'Default', isDefault: true });
    await db.update(users).set({ defaultResumeId: def.id }).where(eq(users.clerkUserId, user.clerkUserId));

    await callDelete(def.id);

    const [promoted] = await db.select().from(resumes).where(eq(resumes.id, older.id));
    expect(promoted?.isDefault).toBe(true);
    const [u] = await db.select().from(users).where(eq(users.clerkUserId, user.clerkUserId));
    expect(u?.defaultResumeId).toBe(older.id);
  });

  it('clears the default pointer when the last resume is deleted', async () => {
    const user = await mkUser(db, { clerkUserId: 'user_A' });
    const only = await mkResume(db, user.clerkUserId, { label: 'Only', isDefault: true });
    await db.update(users).set({ defaultResumeId: only.id }).where(eq(users.clerkUserId, user.clerkUserId));

    await callDelete(only.id);

    const remaining = await db.select().from(resumes).where(eq(resumes.userId, user.clerkUserId));
    expect(remaining).toHaveLength(0);
    const [u] = await db.select().from(users).where(eq(users.clerkUserId, user.clerkUserId));
    expect(u?.defaultResumeId).toBeNull();
  });

  it("does not let user A delete user B's resume", async () => {
    await mkUser(db, { clerkUserId: 'user_A' });
    const b = await mkUser(db, { clerkUserId: 'user_B' });
    const bResume = await mkResume(db, b.clerkUserId, { label: 'B', isDefault: true });

    currentUser = 'user_A';
    const res = await callDelete(bResume.id);
    expect(res.status).toBe(404);
    const rows = await db.select().from(resumes).where(eq(resumes.id, bResume.id));
    expect(rows).toHaveLength(1); // untouched
    expect(delCalls).toHaveLength(0);
  });

  it('returns 404 for an unknown id', async () => {
    await mkUser(db, { clerkUserId: 'user_A' });
    const res = await callDelete('nope');
    expect(res.status).toBe(404);
  });
});
