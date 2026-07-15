import { NextResponse } from 'next/server';
import { fakeMailSender } from '@/lib/mail/fake';
import { requireUserId } from '@/lib/auth';
import { route, jsonError } from '@/lib/http';

export const runtime = 'nodejs';

/** Dev-only window into the FakeMailSender outbox (digest checks in E2E). */
export const GET = route(async () => {
  if (process.env.NODE_ENV === 'production' && process.env.VERCEL_ENV === 'production') {
    return jsonError('NOT_FOUND', 'Not available in production.', 404);
  }
  await requireUserId();
  const outbox = fakeMailSender().outbox.map((m) => ({
    to: m.to,
    subject: m.subject,
    text: m.text,
    messageId: m.messageId,
  }));
  return NextResponse.json({ outbox });
});
