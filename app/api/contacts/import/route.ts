import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { contacts } from '@/db/schema';
import { requireUserRecord } from '@/lib/auth';
import { assertRateLimit } from '@/lib/ratelimit';
import { readJson, route } from '@/lib/http';
import { importSchema } from '@/lib/schemas';

export const runtime = 'nodejs';

export const POST = route(async (req) => {
  const user = await requireUserRecord();
  await assertRateLimit('import', user.clerkUserId);
  const { rows } = await readJson(req, importSchema);
  const db = await getDb();

  let created = 0;
  let skipped = 0;
  const errors: Array<{ index: number; message: string }> = [];

  for (const [index, row] of rows.entries()) {
    try {
      const inserted = await db
        .insert(contacts)
        .values({
          userId: user.clerkUserId,
          email: row.email,
          firstName: row.firstName,
          lastName: row.lastName,
          company: row.company,
          contactRole: row.contactRole,
          targetRole: row.targetRole,
          jobUrl: row.jobUrl ?? null,
          hook: row.hook ?? null,
          linkedinUrl: row.linkedinUrl ?? null,
          tags: row.tags,
          resumeId: row.resumeId ?? null,
          researchOptIn: row.researchOptIn,
          source: row.source === 'manual' ? 'csv' : row.source,
        })
        .onConflictDoNothing()
        .returning({ id: contacts.id });
      if (inserted[0]) created += 1;
      else skipped += 1; // duplicate email for this user
    } catch {
      errors.push({ index, message: `Row ${index + 1} could not be saved.` });
    }
  }

  return NextResponse.json({ created, skipped, errors });
});
