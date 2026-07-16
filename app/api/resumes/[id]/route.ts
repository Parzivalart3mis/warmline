import { NextResponse } from 'next/server';
import { and, desc, eq, ne } from 'drizzle-orm';
import { del } from '@vercel/blob';
import { getDb } from '@/lib/db';
import { resumes, users } from '@/db/schema';
import { requireUserRecord } from '@/lib/auth';
import { assertRateLimit } from '@/lib/ratelimit';
import { ApiError, route } from '@/lib/http';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export const DELETE = route<Ctx>(async (_req, ctx) => {
  const user = await requireUserRecord();
  await assertRateLimit('mutate', user.clerkUserId);
  const { id } = await ctx.params;
  const db = await getDb();

  const [resume] = await db
    .select()
    .from(resumes)
    .where(and(eq(resumes.id, id), eq(resumes.userId, user.clerkUserId)))
    .limit(1);
  if (!resume) throw new ApiError('NOT_FOUND', 'No such resume.', 404);

  const wasDefault = resume.isDefault || user.defaultResumeId === id;

  // Delete the row first — contacts.resume_id falls back to null via the FK,
  // so they use the user default. Then reconcile the default pointer.
  await db.delete(resumes).where(eq(resumes.id, id));

  if (wasDefault) {
    // Promote the newest remaining resume (if any) to default; else clear it.
    const [next] = await db
      .select()
      .from(resumes)
      .where(and(eq(resumes.userId, user.clerkUserId), ne(resumes.id, id)))
      .orderBy(desc(resumes.createdAt))
      .limit(1);
    if (next) {
      await db.update(resumes).set({ isDefault: true }).where(eq(resumes.id, next.id));
    }
    await db
      .update(users)
      .set({ defaultResumeId: next?.id ?? null })
      .where(eq(users.clerkUserId, user.clerkUserId));
  }

  // Best-effort blob cleanup — never let a storage hiccup fail the delete, and
  // skip data-URI resumes (local dev) which have nothing to remove.
  if (resume.blobUrl.startsWith('https://') && process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      await del(resume.blobUrl);
    } catch (err) {
      console.error('[resumes] blob delete failed', err instanceof Error ? err.message : err);
    }
  }

  return NextResponse.json({ ok: true });
});
