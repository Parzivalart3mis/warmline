import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeTestDb, mkUser, mkContact, mkResume, mkRun, mkMessage } from '../helpers/test-db';
import type { Db } from '@/lib/db';
import { contacts, messages, resumes, runs } from '@/db/schema';

/**
 * Cross-user isolation (§8): seed two users, assert user A cannot read,
 * update, or delete any row of user B via the real route handlers. Auth and
 * the DB are mocked to return user A; every route must still scope by userId.
 */

// Which user the mocked auth resolves to for the current test.
let currentUser = 'user_A';
let db: Db;

vi.mock('@/lib/db', () => ({
  getDb: async () => db,
}));

vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth');
  return {
    ...actual,
    requireUserId: async () => currentUser,
    requireUserRecord: async () => {
      const [row] = await db
        .select()
        .from((await import('@/db/schema')).users)
        .where(eq((await import('@/db/schema')).users.clerkUserId, currentUser));
      if (!row) throw new Error('no user');
      return row;
    },
  };
});

// Rate limiting is a no-op without Upstash env, but stub to be safe.
vi.mock('@/lib/ratelimit', () => ({ assertRateLimit: async () => {} }));

const asUser = (u: string) => {
  currentUser = u;
};

async function seedTwoUsers() {
  const a = await mkUser(db, { clerkUserId: 'user_A', email: 'a@gmail.com' });
  const b = await mkUser(db, { clerkUserId: 'user_B', email: 'b@gmail.com' });
  const bContact = await mkContact(db, b.clerkUserId, { email: 'target@b.com', firstName: 'Bee' });
  const bResume = await mkResume(db, b.clerkUserId, { isDefault: true });
  const bRun = await mkRun(db, b.clerkUserId, { kind: 'manual' });
  const bMessage = await mkMessage(db, b.clerkUserId, bContact.id, {
    status: 'needs_review',
    runId: bRun.id,
  });
  return { a, b, bContact, bResume, bRun, bMessage };
}

beforeEach(async () => {
  db = await makeTestDb();
  asUser('user_A');
});

describe('cross-user isolation via route handlers', () => {
  it('A cannot see B contacts in the list', async () => {
    const { bContact } = await seedTwoUsers();
    await mkContact(db, 'user_A', { email: 'mine@a.com' });
    const { GET } = await import('@/app/api/contacts/route');
    const res = await GET(new Request('http://t/api/contacts'));
    const body = await res.json();
    expect(body.contacts).toHaveLength(1);
    expect(body.contacts[0].email).toBe('mine@a.com');
    expect(body.contacts.some((c: { id: string }) => c.id === bContact.id)).toBe(false);
  });

  it("A cannot PATCH B's contact (404, row unchanged)", async () => {
    const { bContact } = await seedTwoUsers();
    const { PATCH } = await import('@/app/api/contacts/[id]/route');
    const res = await PATCH(
      new Request('http://t', { method: 'PATCH', body: JSON.stringify({ firstName: 'Hacked' }) }),
      { params: Promise.resolve({ id: bContact.id }) },
    );
    expect(res.status).toBe(404);
    const [after] = await db.select().from(contacts).where(eq(contacts.id, bContact.id));
    expect(after?.firstName).toBe('Bee');
  });

  it("A cannot DELETE B's contact (404, row survives)", async () => {
    const { bContact } = await seedTwoUsers();
    const { DELETE } = await import('@/app/api/contacts/[id]/route');
    const res = await DELETE(new Request('http://t', { method: 'DELETE' }), {
      params: Promise.resolve({ id: bContact.id }),
    });
    expect(res.status).toBe(404);
    const rows = await db.select().from(contacts).where(eq(contacts.id, bContact.id));
    expect(rows).toHaveLength(1);
  });

  it("A cannot suppress B's contact", async () => {
    const { bContact } = await seedTwoUsers();
    const { POST } = await import('@/app/api/contacts/[id]/suppress/route');
    const res = await POST(
      new Request('http://t', { method: 'POST', headers: { 'content-length': '0' } }),
      {
        params: Promise.resolve({ id: bContact.id }),
      },
    );
    expect(res.status).toBe(404);
    const [after] = await db.select().from(contacts).where(eq(contacts.id, bContact.id));
    expect(after?.suppressed).toBe(false);
  });

  it("A cannot mark B's contact replied", async () => {
    const { bContact } = await seedTwoUsers();
    const { POST } = await import('@/app/api/contacts/[id]/replied/route');
    const res = await POST(new Request('http://t', { method: 'POST' }), {
      params: Promise.resolve({ id: bContact.id }),
    });
    expect(res.status).toBe(404);
    const [after] = await db.select().from(contacts).where(eq(contacts.id, bContact.id));
    expect(after?.repliedAt).toBeNull();
  });

  it("A cannot read B's messages", async () => {
    const { bMessage } = await seedTwoUsers();
    const { GET } = await import('@/app/api/messages/route');
    const res = await GET(new Request('http://t/api/messages'));
    const body = await res.json();
    expect(body.messages.some((m: { id: string }) => m.id === bMessage.id)).toBe(false);
  });

  it("A cannot PATCH B's message", async () => {
    const { bMessage } = await seedTwoUsers();
    const { PATCH } = await import('@/app/api/messages/[id]/route');
    const res = await PATCH(
      new Request('http://t', { method: 'PATCH', body: JSON.stringify({ subject: 'Hijack' }) }),
      { params: Promise.resolve({ id: bMessage.id }) },
    );
    expect(res.status).toBe(404);
    const [after] = await db.select().from(messages).where(eq(messages.id, bMessage.id));
    expect(after?.subject).not.toBe('Hijack');
  });

  it("A cannot cancel B's message", async () => {
    const { bMessage } = await seedTwoUsers();
    const { POST } = await import('@/app/api/messages/[id]/cancel/route');
    const res = await POST(new Request('http://t', { method: 'POST' }), {
      params: Promise.resolve({ id: bMessage.id }),
    });
    expect(res.status).toBe(404);
    const [after] = await db.select().from(messages).where(eq(messages.id, bMessage.id));
    expect(after?.status).toBe('needs_review');
  });

  it("A cannot read B's run detail", async () => {
    const { bRun } = await seedTwoUsers();
    const { GET } = await import('@/app/api/runs/[id]/route');
    const res = await GET(new Request('http://t'), { params: Promise.resolve({ id: bRun.id }) });
    expect(res.status).toBe(404);
  });

  it("A cannot cancel B's run", async () => {
    const { bRun } = await seedTwoUsers();
    const { POST } = await import('@/app/api/runs/[id]/cancel/route');
    const res = await POST(new Request('http://t', { method: 'POST' }), {
      params: Promise.resolve({ id: bRun.id }),
    });
    expect(res.status).toBe(404);
    const [after] = await db.select().from(runs).where(eq(runs.id, bRun.id));
    expect(after?.cancelled).toBe(false);
  });

  it("A cannot make B's resume their default", async () => {
    const { bResume } = await seedTwoUsers();
    const { POST } = await import('@/app/api/resumes/[id]/default/route');
    const res = await POST(new Request('http://t', { method: 'POST' }), {
      params: Promise.resolve({ id: bResume.id }),
    });
    expect(res.status).toBe(404);
  });

  it("A's run detail only shows A's messages even if ids collide by run", async () => {
    const { bRun } = await seedTwoUsers();
    // A owns a run of their own; B's run is invisible.
    const aRun = await mkRun(db, 'user_A', { kind: 'manual' });
    const aContact = await mkContact(db, 'user_A');
    await mkMessage(db, 'user_A', aContact.id, { runId: aRun.id, status: 'queued' });
    const { GET } = await import('@/app/api/runs/[id]/route');
    const res = await GET(new Request('http://t'), { params: Promise.resolve({ id: aRun.id }) });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.messages).toHaveLength(1);
    // And B's run is still forbidden.
    const bRes = await GET(new Request('http://t'), { params: Promise.resolve({ id: bRun.id }) });
    expect(bRes.status).toBe(404);
  });
});
