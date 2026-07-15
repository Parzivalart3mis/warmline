import { MockLanguageModelV4 } from 'ai/test';

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

// Minimal, structurally-assignable subset of LanguageModelV4Content — avoids a
// direct dependency on @ai-sdk/provider (a transitive package under pnpm).
type MockPart =
  { type: 'text'; text: string } | { type: 'source'; sourceType: 'url'; id: string; url: string };

/** A model whose single response is the given content parts. */
function modelFrom(content: MockPart[]) {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content,
      finishReason: { unified: 'stop' as const, raw: 'stop' },
      usage,
      warnings: [],
    }),
  });
}

/** A model that always returns the given JSON payload as its text. */
export function jsonModel(payload: unknown) {
  return modelFrom([{ type: 'text', text: JSON.stringify(payload) }]);
}

/** A model that emits raw, non-JSON text — for "malformed output" cases. */
export function rawTextModel(text = 'not json {{{') {
  return modelFrom([{ type: 'text', text }]);
}

/** A grounded-style model: free text plus URL sources (for research tests). */
export function sourcesModel(
  sources: string[],
  text = 'Findings: raised a round; shipped a product.',
) {
  return modelFrom([
    { type: 'text', text },
    ...sources.map((url, i) => ({
      type: 'source' as const,
      sourceType: 'url' as const,
      id: `s${i}`,
      url,
    })),
  ]);
}

export const passGateModel = () => jsonModel({ verdict: 'pass', issues: [] });
export const flagGateModel = (span = 'an unsupported claim') =>
  jsonModel({ verdict: 'flag', issues: [{ span, reason: 'unsupported_about_me' }] });
export const draftModelMock = (subject = 'Hello there', body = 'Hi,\n\nShort note.\n\nYash') =>
  jsonModel({ subject, body });
