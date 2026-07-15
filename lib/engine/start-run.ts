import { eq } from 'drizzle-orm';
import { start } from 'workflow/api';
import { outreachRun } from '@/app/workflows/outreach-run';
import type { Db } from '@/lib/db';
import { runs, type Run } from '@/db/schema';
import { getMailSender } from '@/lib/mail';
import { ApiError } from '@/lib/http';
import { runInline } from './run-inline';

/**
 * Creates the run row and hands it to the durable workflow. Outside
 * production (or with WORKFLOW_MODE=inline) it falls back to the inline
 * runner so dev/preview — where Workflows may not execute — still drip.
 */
export async function startRun(
  db: Db,
  userId: string,
  kind: 'daily' | 'manual',
  contactIds?: string[],
): Promise<Run> {
  const inserted = await db.insert(runs).values({ userId, kind }).returning();
  const run = inserted[0];
  if (!run) throw new ApiError('INTERNAL', 'Could not create the run.', 500);

  const isProduction = process.env.VERCEL_ENV === 'production';
  const forceInline = process.env.WORKFLOW_MODE === 'inline' && !isProduction;

  if (!forceInline) {
    try {
      const handle = await start(outreachRun, contactIds ? [run.id, contactIds] : [run.id]);
      await db.update(runs).set({ workflowRunId: handle.runId }).where(eq(runs.id, run.id));
      return { ...run, workflowRunId: handle.runId };
    } catch (err) {
      if (isProduction) {
        await db
          .update(runs)
          .set({ status: 'failed', finishedAt: new Date() })
          .where(eq(runs.id, run.id));
        console.error(
          '[startRun] workflow start failed:',
          err instanceof Error ? err.message : err,
        );
        throw new ApiError(
          'WORKFLOW_UNAVAILABLE',
          'The workflow runtime rejected the run. Check Vercel → Observability → Workflows.',
          503,
        );
      }
      console.warn('[startRun] workflow unavailable, using inline runner (dev only)');
    }
  }

  void runInline(db, getMailSender(), run.id, contactIds ? { contactIds } : {}).catch(
    async (err) => {
      console.error('[runInline] failed:', err instanceof Error ? err.message : err);
      await db
        .update(runs)
        .set({ status: 'failed', finishedAt: new Date() })
        .where(eq(runs.id, run.id));
    },
  );
  return run;
}
