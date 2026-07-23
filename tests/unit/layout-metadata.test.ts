import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Guard for the iOS Add-to-Home-Screen regression.
 *
 * Next 15 streams the `metadata` export into the <body> on dynamic pages, so
 * Safari's install parser (which reads the server-rendered head) never sees
 * tags placed there. The manifest link and apple-* metas MUST live as literal
 * JSX in the root layout (part of the synchronous shell) — and must NOT drift
 * back into the metadata export, where they would silently stop working.
 */
const layoutSource = readFileSync(path.resolve(__dirname, '../../app/layout.tsx'), 'utf8');

describe('root layout PWA tags', () => {
  it('renders the manifest and apple metas as literal JSX, not metadata', () => {
    expect(layoutSource).toMatch(/<link rel="manifest" href="\/manifest\.webmanifest" \/>/);
    expect(layoutSource).toMatch(/<meta name="apple-mobile-web-app-capable" content="yes" \/>/);
    expect(layoutSource).toMatch(/<meta name="apple-mobile-web-app-title" content="Warmline" \/>/);
    expect(layoutSource).toMatch(/<link rel="apple-touch-icon"/);
    expect(layoutSource).toMatch(/apple-touch-startup-image/);
  });

  it('keeps those keys OUT of the streamed metadata export', () => {
    // Extract just the `export const metadata` object literal.
    const start = layoutSource.indexOf('export const metadata');
    const end = layoutSource.indexOf('export const viewport');
    const metadataBlock = layoutSource.slice(start, end);
    expect(metadataBlock.length).toBeGreaterThan(0);
    expect(metadataBlock).not.toMatch(/manifest:/);
    expect(metadataBlock).not.toMatch(/appleWebApp/);
    expect(metadataBlock).not.toMatch(/apple-mobile-web-app/);
    expect(metadataBlock).not.toMatch(/startupImage/);
  });
});
