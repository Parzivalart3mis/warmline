/**
 * Fails CI if any text/background pairing in the Airmail palette regresses
 * below the WCAG AA floor (4.5:1 for body text). The palette lives in
 * app/globals.css; this parses it so the source of truth stays there.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type RGB = [number, number, number];

function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function relativeLuminance([r, g, b]: RGB): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(hexToRgb(a));
  const lb = relativeLuminance(hexToRgb(b));
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

function parseBlock(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  const body = css.slice(open + 1, close);
  const vars: Record<string, string> = {};
  for (const line of body.split('\n')) {
    const m = line.match(/--([\w-]+):\s*(#[0-9a-fA-F]{3,6})/);
    if (m && m[1] && m[2]) vars[m[1]] = m[2];
  }
  return vars;
}

const AA = 4.5;

// text-on-surface pairings that carry real content (must meet AA 4.5:1).
const PAIRS: Array<[string, string]> = [
  ['ink', 'bg'],
  ['ink', 'surface'],
  ['muted', 'bg'],
  ['muted', 'surface'],
  ['primary', 'bg'],
  ['primary', 'surface'],
  ['success', 'surface'],
  ['warning', 'surface'],
  ['error', 'surface'],
  ['primary-foreground', 'primary'],
  ['stamp-foreground', 'stamp'],
];

function main() {
  const css = readFileSync(join(process.cwd(), 'app', 'globals.css'), 'utf8');
  const modes = { light: parseBlock(css, ':root {'), dark: parseBlock(css, '.dark {') };

  let failures = 0;
  for (const [mode, vars] of Object.entries(modes)) {
    for (const [fg, bg] of PAIRS) {
      const fgHex = vars[fg];
      const bgHex = vars[bg];
      if (!fgHex || !bgHex) {
        console.error(`✗ [${mode}] missing token: --${fg} or --${bg}`);
        failures += 1;
        continue;
      }
      const ratio = contrastRatio(fgHex, bgHex);
      if (ratio < AA) {
        console.error(`✗ [${mode}] --${fg} on --${bg}: ${ratio.toFixed(2)}:1 (< ${AA})`);
        failures += 1;
      }
    }
  }

  if (failures > 0) {
    console.error(
      `\ncontrast: ${failures} pairing(s) below AA. Fix the palette in app/globals.css.`,
    );
    process.exit(1);
  }
  console.log(`contrast: all ${PAIRS.length * 2} pairings meet WCAG AA (≥${AA}:1).`);
}

main();
