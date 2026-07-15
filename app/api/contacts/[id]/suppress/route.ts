import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireUserRecord } from '@/lib/auth';
import { assertRateLimit } from '@/lib/ratelimit';
import { ApiError, readJson, route } from '@/lib/http';
import { suppressSchema } from '@/lib/schemas';
import { suppressContact } from '@/lib/engine/contact-actions';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export const POST = route<Ctx>(async (req, ctx) => {
  const user = await requireUserRecord();
  await assertRateLimit('mutate', user.clerkUserId);
  const { id } = await ctx.params;
  const body = req.headers.get('content-length') === '0' ? {} : await readJson(req, suppressSchema);
  const db = await getDb();

  const contact = await suppressContact(db, user.clerkUserId, id, body.reason ?? '');
  if (!contact) throw new ApiError('NOT_FOUND', 'No such contact.', 404);
  return NextResponse.json({ ok: true });
});
