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

export const DRAFT_PROVIDER_OPTIONS = {
  google: { thinkingConfig: { thinkingLevel: 'high' as const } },
};

export const GATE_PROVIDER_OPTIONS = {
  google: { thinkingConfig: { thinkingLevel: 'minimal' as const } },
};
