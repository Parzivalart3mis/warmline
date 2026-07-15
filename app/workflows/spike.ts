import { sleep } from 'workflow';

/**
 * §14.2 Workflow spike: three steps, two 2-minute sleeps.
 * Deploy, start it via POST /api/spike/workflow, push a new deploy mid-run,
 * and confirm it survives and completes in Vercel → Observability → Workflows.
 */
export async function spikeWorkflow(label: string) {
  'use workflow';

  const first = await spikeStep(1, label);
  await sleep('2 minutes');
  const second = await spikeStep(2, label);
  await sleep('2 minutes');
  const third = await spikeStep(3, label);

  return { first, second, third };
}

async function spikeStep(n: number, label: string) {
  'use step';
  const at = new Date().toISOString();
  console.log(`[spike] step ${n} (${label}) at ${at}`);
  return { n, at };
}
