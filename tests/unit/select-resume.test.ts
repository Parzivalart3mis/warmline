import { describe, it, expect } from 'vitest';
import { selectResume, hasSelectionSignal } from '@/lib/ai/select-resume';
import { jsonModel, rawTextModel } from '../helpers/mock-model';

const candidates = [
  { id: 'r-backend', label: 'Backend', extractedText: 'Go, Postgres, Kafka, distributed systems.' },
  { id: 'r-ml', label: 'ML', extractedText: 'PyTorch, transformers, retrieval, feature stores.' },
];

describe('hasSelectionSignal', () => {
  it('needs a target role or a job posting', () => {
    expect(hasSelectionSignal({ targetRole: 'Backend Engineer' })).toBe(true);
    expect(hasSelectionSignal({ jobPostingText: 'We are hiring…' })).toBe(true);
    expect(hasSelectionSignal({})).toBe(false);
    expect(hasSelectionSignal({ targetRole: '   ' })).toBe(false);
  });
});

describe('selectResume', () => {
  it('returns the resume whose label the model picked', async () => {
    const picked = await selectResume(
      { candidates, targetRole: 'ML Engineer' },
      { model: jsonModel({ resumeLabel: 'ML', reason: 'Job is model-serving work.' }) },
    );
    expect(picked?.id).toBe('r-ml');
    expect(picked?.label).toBe('ML');
    expect(picked?.reason).toContain('model-serving');
  });

  it('matches labels case-insensitively and ignores surrounding space', async () => {
    const picked = await selectResume(
      { candidates, targetRole: 'Backend Engineer' },
      { model: jsonModel({ resumeLabel: '  backend  ' }) },
    );
    expect(picked?.id).toBe('r-backend');
  });

  it('returns null when the model invents a label (never guesses)', async () => {
    const picked = await selectResume(
      { candidates, targetRole: 'Backend Engineer' },
      { model: jsonModel({ resumeLabel: 'Quantum Alchemy' }) },
    );
    expect(picked).toBeNull();
  });

  it('fails open to null on malformed model output', async () => {
    const picked = await selectResume(
      { candidates, targetRole: 'Backend Engineer' },
      { model: rawTextModel() },
    );
    expect(picked).toBeNull();
  });

  it('does not call the model with fewer than two versions', async () => {
    const picked = await selectResume(
      { candidates: [candidates[0]!], targetRole: 'Backend Engineer' },
      {
        model: jsonModel({ resumeLabel: 'Backend' }),
      },
    );
    expect(picked).toBeNull();
  });

  it('does not call the model without signal', async () => {
    const picked = await selectResume(
      { candidates, targetRole: '' },
      { model: jsonModel({ resumeLabel: 'ML' }) },
    );
    expect(picked).toBeNull();
  });
});

describe('over-long model output does not break selection (regression)', () => {
  it('clamps a long reason instead of failing the whole call', async () => {
    // The real bug: `reason` had .max(200), so a longer explanation made
    // structured-output generation fail and silently fell back to the default.
    const picked = await selectResume(
      { candidates, targetRole: 'Backend Engineer' },
      {
        model: jsonModel({
          resumeLabel: 'Backend',
          reason: 'Because '.repeat(60), // ~480 chars, well over the old cap
        }),
      },
    );
    expect(picked?.id).toBe('r-backend'); // still selects
    expect(picked?.reason?.length).toBeLessThanOrEqual(200); // clamped, not fatal
  });
});
