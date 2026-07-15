import { NextResponse } from 'next/server';
import { and, eq, ilike, lt, or, desc, type SQL } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { contacts } from '@/db/schema';
import { requireUserRecord } from '@/lib/auth';
import { assertRateLimit } from '@/lib/ratelimit';
import { ApiError, readJson, parseQuery, route } from '@/lib/http';
import { contactCreateSchema, contactListQuerySchema } from '@/lib/schemas';

export const runtime = 'nodejs';

const PAGE_SIZE = 50;

export const GET = route(async (req) => {
  const user = await requireUserRecord();
  const query = parseQuery(req.url, contactListQuerySchema);
  const db = await getDb();

  const where: SQL[] = [eq(contacts.userId, user.clerkUserId)];
  if (query.status) where.push(eq(contacts.status, query.status));
  if (query.q) {
    const q = `%${query.q}%`;
    const search = or(
      ilike(contacts.firstName, q),
      ilike(contacts.lastName, q),
      ilike(contacts.company, q),
      ilike(contacts.email, q),
    );
    if (search) where.push(search);
  }
  if (query.cursor) {
    const [ts, id] = Buffer.from(query.cursor, 'base64url').toString('utf8').split('_');
    const cursorDate = new Date(Number(ts));
    if (!Number.isNaN(cursorDate.getTime()) && id) {
      const key = or(
        lt(contacts.createdAt, cursorDate),
        and(eq(contacts.createdAt, cursorDate), lt(contacts.id, id)),
      );
      if (key) where.push(key);
    }
  }

  const rows = await db
    .select()
    .from(contacts)
    .where(and(...where))
    .orderBy(desc(contacts.createdAt), desc(contacts.id))
    .limit(PAGE_SIZE + 1);

  const page = rows.slice(0, PAGE_SIZE);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > PAGE_SIZE && last
      ? Buffer.from(`${last.createdAt.getTime()}_${last.id}`).toString('base64url')
      : null;

  return NextResponse.json({ contacts: page, nextCursor });
});

export const POST = route(async (req) => {
  const user = await requireUserRecord();
  await assertRateLimit('mutate', user.clerkUserId);
  const input = await readJson(req, contactCreateSchema);
  const db = await getDb();

  const inserted = await db
    .insert(contacts)
    .values({
      userId: user.clerkUserId,
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
      company: input.company,
      contactRole: input.contactRole,
      targetRole: input.targetRole,
      jobUrl: input.jobUrl ?? null,
      hook: input.hook ?? null,
      linkedinUrl: input.linkedinUrl ?? null,
      tags: input.tags,
      resumeId: input.resumeId ?? null,
      researchOptIn: input.researchOptIn,
      source: input.source,
    })
    .onConflictDoNothing()
    .returning();

  const contact = inserted[0];
  if (!contact) {
    throw new ApiError('CONFLICT', 'A contact with that email already exists.', 409);
  }
  return NextResponse.json({ contact }, { status: 201 });
});
