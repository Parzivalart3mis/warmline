import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireUserRecord } from '@/lib/auth';
import { assertRateLimit } from '@/lib/ratelimit';
import { ApiError, route } from '@/lib/http';
import { markReplied } from '@/lib/engine/contact-actions';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export const POST = route<Ctx>(async (_req, ctx) => {
  const user = await requireUserRecord();
  await assertRateLimit('mutate', user.clerkUserId);
  const { id } = await ctx.params;
  const db = await getDb();

  const contact = await markReplied(db, user.clerkUserId, id);
  if (!contact) throw new ApiError('NOT_FOUND', 'No such contact.', 404);
  return NextResponse.json({ contact });
});
