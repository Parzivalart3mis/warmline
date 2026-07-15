import { describe, it, expect } from 'vitest';
import { buildDigestText } from '@/lib/engine/digest';
import { htmlToText } from '@/lib/net/html-text';

describe('buildDigestText', () => {
  it('lists what is going out and the grace window', () => {
    const text = buildDigestText({
      queued: [
        { name: 'Priya Raman', company: 'Stripe', subject: 'Quick note', step: 1 },
        { name: 'Lena Fischer', company: 'Temporal', subject: 'Re: Earlier', step: 2 },
      ],
      held: [],
      graceMinutes: 10,
    });
    expect(text).toContain('about to send 2 emails');
    expect(text).toContain('10 minutes');
    expect(text).toContain('Priya Raman — Stripe');
    expect(text).toContain('Lena Fischer — Temporal (follow-up 1)');
    expect(text).toContain('Quick note');
  });

  it('lists held drafts separately and says they will not send', () => {
    const text = buildDigestText({
      queued: [],
      held: [{ name: 'Hana Tanaka', company: 'Anthropic', reason: 'flagged unsupported claims' }],
      graceMinutes: 10,
    });
    expect(text).toContain('Nothing is queued');
    expect(text).toMatch(/will NOT send/i);
    expect(text).toContain('Hana Tanaka — Anthropic: flagged unsupported claims');
  });

  it('uses the singular for a single email', () => {
    const text = buildDigestText({
      queued: [{ name: 'A B', company: 'C', subject: 'S', step: 1 }],
      held: [],
      graceMinutes: 10,
    });
    expect(text).toContain('about to send 1 email.');
  });
});

describe('htmlToText', () => {
  it('strips scripts, styles, and tags', () => {
    const html =
      '<html><head><style>.x{color:red}</style></head><body><h1>Backend Engineer</h1><script>evil()</script><p>Build systems.</p></body></html>';
    const text = htmlToText(html);
    expect(text).toContain('Backend Engineer');
    expect(text).toContain('Build systems.');
    expect(text).not.toContain('evil');
    expect(text).not.toContain('color:red');
  });

  it('decodes common entities and preserves paragraph breaks', () => {
    const text = htmlToText('<p>Ben &amp; Jerry</p><p>Second&nbsp;line</p>');
    expect(text).toContain('Ben & Jerry');
    expect(text).toContain('Second line');
    expect(text.split('\n').length).toBeGreaterThan(1);
  });

  it('truncates very long input', () => {
    const text = htmlToText(`<p>${'a'.repeat(30_000)}</p>`, 1_000);
    expect(text.length).toBeLessThanOrEqual(1_001);
    expect(text.endsWith('…')).toBe(true);
  });
});
