import { NextResponse } from 'next/server';
import { and, desc, eq, type SQL } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { contacts, messages } from '@/db/schema';
import { requireUserRecord } from '@/lib/auth';
import { parseQuery, route } from '@/lib/http';
import { messageListQuerySchema } from '@/lib/schemas';

export const runtime = 'nodejs';

export const GET = route(async (req) => {
  const user = await requireUserRecord();
  const query = parseQuery(req.url, messageListQuerySchema);
  const db = await getDb();

  const where: SQL[] = [eq(messages.userId, user.clerkUserId)];
  if (query.status) where.push(eq(messages.status, query.status));
  if (query.runId) where.push(eq(messages.runId, query.runId));

  const rows = await db
    .select({
      message: messages,
      contact: {
        id: contacts.id,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        company: contacts.company,
        email: contacts.email,
      },
    })
    .from(messages)
    .innerJoin(contacts, eq(messages.contactId, contacts.id))
    .where(and(...where))
    .orderBy(desc(messages.createdAt))
    .limit(200);

  return NextResponse.json({
    messages: rows.map((r) => ({ ...r.message, contact: r.contact })),
  });
});
