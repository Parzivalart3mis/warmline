import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { contacts } from '@/db/schema';
import { requireUserRecord } from '@/lib/auth';
import { assertRateLimit } from '@/lib/ratelimit';
import { ApiError, readJson, route } from '@/lib/http';
import { contactUpdateSchema } from '@/lib/schemas';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = route<Ctx>(async (req, ctx) => {
  const user = await requireUserRecord();
  await assertRateLimit('mutate', user.clerkUserId);
  const { id } = await ctx.params;
  const input = await readJson(req, contactUpdateSchema);
  const db = await getDb();

  const updated = await db
    .update(contacts)
    .set({
      ...(input.email !== undefined ? { email: input.email } : {}),
      ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
      ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
      ...(input.company !== undefined ? { company: input.company } : {}),
      ...(input.contactRole !== undefined ? { contactRole: input.contactRole } : {}),
      ...(input.targetRole !== undefined ? { targetRole: input.targetRole } : {}),
      ...(input.jobUrl !== undefined ? { jobUrl: input.jobUrl } : {}),
      ...(input.hook !== undefined ? { hook: input.hook } : {}),
      ...(input.linkedinUrl !== undefined ? { linkedinUrl: input.linkedinUrl } : {}),
      ...(input.tags !== undefined ? { tags: input.tags } : {}),
      ...(input.resumeId !== undefined ? { resumeId: input.resumeId } : {}),
      ...(input.researchOptIn !== undefined ? { researchOptIn: input.researchOptIn } : {}),
    })
    .where(and(eq(contacts.id, id), eq(contacts.userId, user.clerkUserId)))
    .returning();

  const contact = updated[0];
  if (!contact) throw new ApiError('NOT_FOUND', 'No such contact.', 404);
  return NextResponse.json({ contact });
});

export const DELETE = route<Ctx>(async (_req, ctx) => {
  const user = await requireUserRecord();
  await assertRateLimit('mutate', user.clerkUserId);
  const { id } = await ctx.params;
  const db = await getDb();

  const deleted = await db
    .delete(contacts)
    .where(and(eq(contacts.id, id), eq(contacts.userId, user.clerkUserId)))
    .returning();
  if (!deleted[0]) throw new ApiError('NOT_FOUND', 'No such contact.', 404);
  return NextResponse.json({ ok: true });
});
