/**
 * Fails CI if a form control (<input>, <select>, <textarea>) carries a
 * sub-16px Tailwind text class. iOS auto-zooms on focus below 16px regardless
 * of the viewport meta — the single most common way a PWA betrays itself.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOTS = ['app', 'components'];
const SMALL_TEXT = /\btext-(xs|sm)\b/;
const CONTROL = /<(input|select|textarea)\b/i;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      out.push(...walk(full));
    } else if (['.tsx', '.ts'].includes(extname(full))) {
      out.push(full);
    }
  }
  return out;
}

/** Flag a small-text class only when it sits inside a control's own tag. */
function offendingLines(source: string): number[] {
  const lines = source.split('\n');
  const hits: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (!CONTROL.test(line)) continue;
    // Gather the tag across lines until '>'.
    let tag = line;
    let j = i;
    while (!tag.includes('>') && j < lines.length - 1) {
      j += 1;
      tag += '\n' + (lines[j] ?? '');
    }
    const openTag = tag.slice(0, tag.indexOf('>') + 1);
    if (SMALL_TEXT.test(openTag)) hits.push(i + 1);
  }
  return hits;
}

function main() {
  let failures = 0;
  for (const root of ROOTS) {
    let files: string[];
    try {
      files = walk(root);
    } catch {
      continue;
    }
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const line of offendingLines(source)) {
        console.error(
          `✗ ${file}:${line} — form control with text-xs/text-sm (iOS will zoom on focus)`,
        );
        failures += 1;
      }
    }
  }
  if (failures > 0) {
    console.error(`\ninput-font: ${failures} control(s) under 16px. Remove the small-text class.`);
    process.exit(1);
  }
  console.log('input-font: no form control carries a sub-16px text class.');
}

main();
