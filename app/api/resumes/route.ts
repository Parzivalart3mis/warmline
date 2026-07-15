import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { put } from '@vercel/blob';
import { getDb } from '@/lib/db';
import { resumes, users } from '@/db/schema';
import { requireUserRecord } from '@/lib/auth';
import { assertRateLimit } from '@/lib/ratelimit';
import { ApiError, route } from '@/lib/http';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_BYTES = 5 * 1024 * 1024;

export const GET = route(async () => {
  const user = await requireUserRecord();
  const db = await getDb();
  const rows = await db
    .select({
      id: resumes.id,
      label: resumes.label,
      fileName: resumes.fileName,
      isDefault: resumes.isDefault,
      createdAt: resumes.createdAt,
      textLength: resumes.extractedText,
    })
    .from(resumes)
    .where(eq(resumes.userId, user.clerkUserId))
    .orderBy(desc(resumes.isDefault), desc(resumes.createdAt));
  return NextResponse.json({
    resumes: rows.map((r) => ({ ...r, textLength: r.textLength.length })),
  });
});

export const POST = route(async (req) => {
  const user = await requireUserRecord();
  await assertRateLimit('upload', user.clerkUserId);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new ApiError('VALIDATION_ERROR', 'Send multipart form data with a "file" field.', 400);
  }
  const file = form.get('file');
  const label = String(form.get('label') ?? '')
    .trim()
    .slice(0, 100);
  if (!(file instanceof File)) {
    throw new ApiError('VALIDATION_ERROR', 'Attach the resume PDF as "file".', 400);
  }
  if (!label) throw new ApiError('VALIDATION_ERROR', 'Give this resume version a label.', 400);
  if (file.size > MAX_BYTES) {
    throw new ApiError('TOO_LARGE', 'Resumes must be 5MB or smaller.', 413);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  // Magic bytes, not just content-type: %PDF
  if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) {
    throw new ApiError('VALIDATION_ERROR', 'That file is not a PDF.', 400);
  }

  // Extract text at upload time (unpdf, Node runtime).
  let extractedText = '';
  try {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(bytes);
    const { text } = await extractText(pdf, { mergePages: true });
    extractedText = text.trim().slice(0, 50_000);
  } catch {
    throw new ApiError(
      'EXTRACTION_FAILED',
      'Could not read text from that PDF. Export it again (no scans or images).',
      422,
    );
  }
  if (extractedText.length < 100) {
    throw new ApiError(
      'EXTRACTION_FAILED',
      'That PDF has almost no extractable text. Export a text-based PDF, not a scan.',
      422,
    );
  }

  const fileName =
    (file.name || 'resume.pdf').replace(/[^\w.\- ]+/g, '').slice(0, 120) || 'resume.pdf';

  // Blob in real environments; data URI fallback keeps local dev working.
  let blobUrl: string;
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const blob = await put(`resumes/${user.clerkUserId}/${fileName}`, Buffer.from(bytes), {
      access: 'public',
      addRandomSuffix: true,
      contentType: 'application/pdf',
    });
    blobUrl = blob.url;
  } else if (process.env.NODE_ENV !== 'production') {
    blobUrl = `data:application/pdf;base64,${Buffer.from(bytes).toString('base64')}`;
  } else {
    throw new ApiError('STORAGE_UNAVAILABLE', 'BLOB_READ_WRITE_TOKEN is not set.', 503);
  }

  const db = await getDb();
  const countRows = await db
    .select({ id: resumes.id })
    .from(resumes)
    .where(eq(resumes.userId, user.clerkUserId));
  const isFirst = countRows.length === 0;

  const inserted = await db
    .insert(resumes)
    .values({
      userId: user.clerkUserId,
      label,
      fileName,
      blobUrl,
      extractedText,
      isDefault: isFirst,
    })
    .returning();
  const resume = inserted[0];
  if (!resume) throw new ApiError('INTERNAL', 'Could not save the resume.', 500);

  if (isFirst) {
    await db
      .update(users)
      .set({ defaultResumeId: resume.id })
      .where(eq(users.clerkUserId, user.clerkUserId));
  }

  return NextResponse.json(
    { resume: { ...resume, extractedText: undefined, textLength: extractedText.length } },
    { status: 201 },
  );
});
