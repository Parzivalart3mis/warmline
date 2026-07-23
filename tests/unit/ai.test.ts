import { describe, it, expect } from 'vitest';
import { runGate, gateMode, gateSchema } from '@/lib/ai/gate';
import { generateDraft, draftPrompt } from '@/lib/ai/draft';
import { researchCompany, isResearchFresh } from '@/lib/ai/research';
import { jsonModel, sourcesModel, rawTextModel } from '../helpers/mock-model';

const brokenModel = () => rawTextModel();

const gateInput = {
  subject: 'Quick note',
  body: 'Hi — I built a reconciliation service in Go.',
  resumeText: 'Built a reconciliation service in Go at a fintech.',
  facts: [],
};

describe('faithfulness gate', () => {
  it('passes a clean draft', async () => {
    const result = await runGate(gateInput, { model: jsonModel({ verdict: 'pass', issues: [] }) });
    expect(result).toEqual({ verdict: 'pass', issues: [] });
  });

  it('flags with spans and reasons', async () => {
    const issues = [
      { span: 'we both worked at Google', reason: 'unsupported_about_me' },
      { span: 'your team tripled', reason: 'unsupported_about_them' },
    ];
    const result = await runGate(gateInput, { model: jsonModel({ verdict: 'flag', issues }) });
    expect(result.verdict).toBe('flag');
    expect(result.issues).toHaveLength(2);
  });

  it('treats a "pass" that lists issues as a flag (defensive)', async () => {
    const result = await runGate(gateInput, {
      model: jsonModel({
        verdict: 'pass',
        issues: [{ span: 'x', reason: 'fabricated_source' }],
      }),
    });
    expect(result.verdict).toBe('flag');
  });

  it('fails CLOSED after two malformed responses', async () => {
    const result = await runGate(gateInput, { model: brokenModel() });
    expect(result.verdict).toBe('error');
  });

  it('rejects out-of-enum reasons at the schema layer', () => {
    const parsed = gateSchema.safeParse({
      verdict: 'flag',
      issues: [{ span: 'x', reason: 'vibes' }],
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects unknown verdicts at the schema layer', () => {
    expect(gateSchema.safeParse({ verdict: 'maybe', issues: [] }).success).toBe(false);
  });

  it('defaults gate mode to block', () => {
    const prev = process.env.AI_GATE_MODE;
    delete process.env.AI_GATE_MODE;
    expect(gateMode()).toBe('block');
    process.env.AI_GATE_MODE = 'nonsense';
    expect(gateMode()).toBe('block');
    process.env.AI_GATE_MODE = 'warn';
    expect(gateMode()).toBe('warn');
    if (prev === undefined) delete process.env.AI_GATE_MODE;
    else process.env.AI_GATE_MODE = prev;
  });
});

const draftInput = {
  resumeText: 'Yash Sharma. Built things.',
  tone: 'warm-direct',
  contact: {
    firstName: 'Priya',
    lastName: 'Raman',
    company: 'Stripe',
    contactRole: 'EM',
    targetRole: 'Backend Engineer',
    hook: 'QCon talk',
  },
  facts: [{ claim: 'Stripe launched X', sourceUrl: 'https://stripe.com/blog/x' }],
  step: 1,
};

describe('draft generator', () => {
  it('returns subject/body and records the model id', async () => {
    const result = await generateDraft(draftInput, {
      model: jsonModel({ subject: 'Hello Priya', body: 'Hi Priya,\n\nShort note.\n\nYash' }),
    });
    expect(result.subject).toBe('Hello Priya');
    expect(result.model).toContain('gemini');
  });

  it('forces follow-up subjects into the thread deterministically', async () => {
    const result = await generateDraft(
      { ...draftInput, step: 2, previous: { subject: 'Original subject', body: 'Earlier note' } },
      { model: jsonModel({ subject: 'Something else entirely', body: 'Following up.' }) },
    );
    expect(result.subject).toBe('Re: Original subject');
  });

  it('bakes the hard rules and context into the prompt', () => {
    const { system, prompt } = draftPrompt(draftInput);
    expect(system).toContain('Under 180 words');
    expect(system).toContain('finds you well');
    expect(system).toContain('warm-direct');
    expect(prompt).toContain("SENDER'S RESUME");
    expect(prompt.indexOf('RESUME')).toBeLessThan(prompt.indexOf('RECIPIENT')); // stable prefix → implicit cache
    expect(prompt).toContain('Stripe launched X');
    expect(prompt).toContain('QCon talk');
  });

  it('keeps the tone dynamic so the Settings dropdown stays live', () => {
    for (const tone of ['warm-direct', 'formal', 'understated']) {
      const { system } = draftPrompt({ ...draftInput, tone });
      expect(system).toContain(`Tone: ${tone}.`);
    }
  });

  it('constrains the subject line', () => {
    const { system } = draftPrompt(draftInput);
    expect(system).toMatch(/Subject line: under 8 words/);
    expect(system).toMatch(/"opportunity"/);
  });

  it('restricts the ask to referral / pointer / resume review, never a call', () => {
    const { system } = draftPrompt(draftInput);
    expect(system).toMatch(/a referral for a named role/);
    expect(system).toMatch(/a pointer to the right team or person/);
    expect(system).toMatch(/a resume review/);
    expect(system).toMatch(/Never ask for a call, meeting, coffee chat/);
  });

  it('requires company facts to earn their place, not act as flattery', () => {
    const { system } = draftPrompt(draftInput);
    expect(system).toMatch(/Never use a fact as standalone flattery/);
  });

  it('forbids claiming the sender applied, from job-posting instructions', () => {
    const { system } = draftPrompt(draftInput);
    expect(system).toMatch(/instructions aimed at applicants/i);
    expect(system).toMatch(/Never state or imply the sender has applied, submitted, attached/i);
  });

  it('carries the banned-phrase list', () => {
    const { system } = draftPrompt(draftInput);
    for (const banned of ['I wanted to reach out', 'passionate', 'leverage', 'synergy']) {
      expect(system).toContain(banned);
    }
    expect(system).toContain('No em dashes');
  });

  it('includes the previous message for follow-ups', () => {
    const { prompt } = draftPrompt({
      ...draftInput,
      step: 2,
      previous: { subject: 'Original', body: 'The first email body' },
    });
    expect(prompt).toContain('The first email body');
    expect(prompt).toContain('Re: Original');
  });

  it('injects today and the tense rule so finished degrees are not called ongoing', () => {
    const { system } = draftPrompt({ ...draftInput, now: new Date('2026-07-16T00:00:00Z') });
    expect(system).toContain('July 16, 2026');
    expect(system).toMatch(/COMPLETED/);
    expect(system).toMatch(/Present|Current/);
    expect(system).toMatch(/not ongoing|currently/i);
  });
});

describe('company research', () => {
  const groundedModel = sourcesModel;

  it('keeps only facts whose sourceUrl matches a real grounding source', async () => {
    const facts = await researchCompany(
      { company: 'Stripe' },
      {
        groundedModel: groundedModel(['https://real.example.com/a']),
        structuringModel: jsonModel({
          facts: [
            { claim: 'Real fact', sourceUrl: 'https://real.example.com/a' },
            { claim: 'Fabricated source', sourceUrl: 'https://made-up.example.com/b' },
          ],
        }),
      },
    );
    expect(facts).toEqual([{ claim: 'Real fact', sourceUrl: 'https://real.example.com/a' }]);
  });

  it('accepts the fetched job posting URL as a source', async () => {
    const facts = await researchCompany(
      { company: 'Stripe', jobUrl: 'https://stripe.com/jobs/123', jobPostingText: 'Backend role' },
      {
        groundedModel: groundedModel(['https://real.example.com/a']),
        structuringModel: jsonModel({
          facts: [{ claim: 'Hiring for backend', sourceUrl: 'https://stripe.com/jobs/123' }],
        }),
      },
    );
    expect(facts).toHaveLength(1);
  });

  it('returns nothing when grounding produced no sources', async () => {
    const facts = await researchCompany(
      { company: 'Mystery Co' },
      {
        groundedModel: groundedModel([]),
        structuringModel: jsonModel({ facts: [{ claim: 'x', sourceUrl: 'https://a.example' }] }),
      },
    );
    expect(facts).toEqual([]);
  });

  it('returns [] on model failure — research is best-effort, the gate enforces', async () => {
    const facts = await researchCompany(
      { company: 'Stripe' },
      { groundedModel: brokenModel(), structuringModel: brokenModel() },
    );
    expect(facts).toEqual([]);
  });

  it('caps at three facts', async () => {
    const urls = ['https://a.example/1', 'https://a.example/2', 'https://a.example/3'];
    const facts = await researchCompany(
      { company: 'Stripe' },
      {
        groundedModel: groundedModel(urls),
        structuringModel: jsonModel({
          facts: urls.map((u, i) => ({ claim: `fact ${i}`, sourceUrl: u })),
        }),
      },
    );
    expect(facts.length).toBeLessThanOrEqual(3);
  });
});

describe('research freshness', () => {
  it('is fresh under 14 days and stale after', () => {
    const now = new Date('2026-07-14T12:00:00Z');
    expect(isResearchFresh(new Date('2026-07-05T12:00:00Z'), now)).toBe(true);
    expect(isResearchFresh(new Date('2026-06-01T12:00:00Z'), now)).toBe(false);
    expect(isResearchFresh(null, now)).toBe(false);
  });
});

describe('over-long model output is clamped, not fatal (regression)', () => {
  it('gate: a very long span still yields a usable flag', async () => {
    const result = await runGate(gateInput, {
      model: jsonModel({
        verdict: 'flag',
        issues: [{ span: 'x'.repeat(900), reason: 'unsupported_about_me' }],
      }),
    });
    expect(result.verdict).toBe('flag'); // not 'error'
    expect(result.issues[0]?.span.length).toBeLessThanOrEqual(300);
  });

  it('draft: an over-long body is truncated rather than failing generation', async () => {
    const result = await generateDraft(draftInput, {
      model: jsonModel({ subject: 'S'.repeat(400), body: 'word '.repeat(4000) }),
    });
    expect(result.subject.length).toBeLessThanOrEqual(200);
    expect(result.body.length).toBeLessThanOrEqual(10_000);
    expect(result.body.length).toBeGreaterThan(0);
  });
});
