import { NextResponse } from 'next/server';
import { and, asc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { contacts, messages, runs } from '@/db/schema';
import { requireUserRecord } from '@/lib/auth';
import { ApiError, route } from '@/lib/http';
import { reconcileStuckSending } from '@/lib/engine/reconcile';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (_req, ctx) => {
  const user = await requireUserRecord();
  const { id } = await ctx.params;
  const db = await getDb();

  // Lazy reconciliation: anything stuck in `sending` >5min becomes held.
  await reconcileStuckSending(db);

  const [run] = await db
    .select()
    .from(runs)
    .where(and(eq(runs.id, id), eq(runs.userId, user.clerkUserId)))
    .limit(1);
  if (!run) throw new ApiError('NOT_FOUND', 'No such run.', 404);

  const rows = await db
    .select({
      message: messages,
      contact: {
        id: contacts.id,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        company: contacts.company,
      },
    })
    .from(messages)
    .innerJoin(contacts, eq(messages.contactId, contacts.id))
    .where(eq(messages.runId, id))
    .orderBy(asc(messages.scheduledFor), asc(messages.createdAt));

  return NextResponse.json({
    run,
    messages: rows.map((r) => ({ ...r.message, contact: r.contact })),
  });
});
