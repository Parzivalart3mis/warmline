import { google } from '@ai-sdk/google';

/**
 * Model choices (§7). One place to change them.
 *  - Research: grounded with Google Search (5,000 free grounded prompts/mo).
 *  - Draft: high thinking — runs in a background batch, quality over latency.
 *  - Gate: flash-lite, minimal thinking, ~$0.001 per check.
 */
export const RESEARCH_MODEL_ID = 'gemini-3.5-flash';
export const DRAFT_MODEL_ID = 'gemini-3.5-flash';
export const GATE_MODEL_ID = 'gemini-3.1-flash-lite';

export const researchModel = () => google(RESEARCH_MODEL_ID);
export const draftModel = () => google(DRAFT_MODEL_ID);
export const gateModel = () => google(GATE_MODEL_ID);

/**
 * Draft thinking is deliberately 'low', not 'high'. At 'high' the model spent
 * ~1,900 of ~2,100 output tokens reasoning and a single call ran 60-180s —
 * past a serverless function's budget, which stalled the workflow's prepare
 * step. 'low' keeps the draft well inside one invocation. Quality is still
 * guarded by the faithfulness gate, which blocks unsupported claims.
 */
export const DRAFT_PROVIDER_OPTIONS = {
  google: { thinkingConfig: { thinkingLevel: 'low' as const } },
};

export const GATE_PROVIDER_OPTIONS = {
  google: { thinkingConfig: { thinkingLevel: 'minimal' as const } },
};
