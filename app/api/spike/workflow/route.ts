import { start } from 'workflow/api';
import { timingSafeEqual } from 'node:crypto';
import { spikeWorkflow } from '@/app/workflows/spike';

export const runtime = 'nodejs';

function bearerMatches(header: string | null, secret: string | undefined) {
  if (!header || !secret) return false;
  const given = Buffer.from(header.replace(/^Bearer\s+/i, ''));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function POST(req: Request) {
  if (!bearerMatches(req.headers.get('authorization'), process.env.CRON_SECRET)) {
    return Response.json(
      { error: { code: 'UNAUTHORIZED', message: 'Bad or missing bearer token.' } },
      { status: 401 },
    );
  }
  const run = await start(spikeWorkflow, [`spike-${Date.now()}`]);
  return Response.json({ started: run.runId });
}
