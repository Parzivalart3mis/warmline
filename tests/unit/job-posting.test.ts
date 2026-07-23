import { describe, it, expect } from 'vitest';
import { jobPostingText, extractJobPostingLd } from '@/lib/net/job-posting';

// A Phenom/ATS-style page: the visible shell says "filled", but the real
// description lives in a schema.org JobPosting script block.
const ldPage = `<!doctype html><html><head>
<script type="application/ld+json">
${JSON.stringify({
  '@context': 'https://schema.org/',
  '@type': 'JobPosting',
  title: 'Software Engineer II',
  description:
    '<p>Job Description:</p><p><b>Our Team:</b></p><p>Build backend systems for pet parents. You&#39;ll own CI/CD &amp; services.</p>',
})}
</script>
</head><body>
<div>We're sorry… the job you are trying to apply for has been filled.</div>
</body></html>`;

describe('extractJobPostingLd', () => {
  it('pulls the JobPosting out of an ld+json block', () => {
    const posting = extractJobPostingLd(ldPage);
    expect(posting?.title).toBe('Software Engineer II');
    expect(posting?.description).toContain('Our Team');
  });

  it('handles an @graph wrapper and a JobPosting inside an array', () => {
    const graph = `<script type="application/ld+json">${JSON.stringify({
      '@graph': [{ '@type': 'WebSite' }, { '@type': 'JobPosting', description: 'Real JD text.' }],
    })}</script>`;
    expect(extractJobPostingLd(graph)?.description).toBe('Real JD text.');
  });

  it('returns null when there is no JobPosting', () => {
    expect(extractJobPostingLd('<html><body>nothing here</body></html>')).toBeNull();
  });

  it('survives a malformed ld+json block and reads the next one', () => {
    const page = `<script type="application/ld+json">{ broken json </script>
      <script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', description: 'Recovered.' })}</script>`;
    expect(extractJobPostingLd(page)?.description).toBe('Recovered.');
  });
});

describe('jobPostingText', () => {
  it('prefers the structured description over the misleading page shell', () => {
    const text = jobPostingText(ldPage);
    expect(text).toContain('Software Engineer II'); // title prepended
    expect(text).toContain('Our Team');
    expect(text).toContain("You'll own CI/CD & services."); // entities decoded
    expect(text).not.toMatch(/has been filled/i); // the fallback shell is not used
  });

  it('falls back to visible text when there is no structured data', () => {
    const html = '<html><body><h1>Backend Engineer</h1><p>Join us. Build things.</p></body></html>';
    const text = jobPostingText(html);
    expect(text).toContain('Backend Engineer');
    expect(text).toContain('Build things.');
  });

  it('truncates very long descriptions', () => {
    const long = `<script type="application/ld+json">${JSON.stringify({
      '@type': 'JobPosting',
      description: 'x'.repeat(30_000),
    })}</script>`;
    const text = jobPostingText(long, 1_000);
    expect(text.length).toBeLessThanOrEqual(1_001);
    expect(text.endsWith('…')).toBe(true);
  });
});
