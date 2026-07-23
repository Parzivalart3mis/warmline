/**
 * Fails CI if any module reachable from a workflow step uses a dynamic
 * `await import()`.
 *
 * The Workflow SDK builds each step's module graph statically at build time.
 * A runtime dynamic import is not in the step bundle, so the step throws the
 * moment it runs — and the workflow retries it forever, with no error surfaced
 * outside the platform's logs. It looks exactly like a hang. This cost a full
 * debugging cycle once; the grep is cheaper than doing it twice.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

// Everything the workflow steps reach into.
const ROOTS = ['lib/engine', 'lib/ai', 'lib/net', 'lib/mail', 'app/workflows'];
const DYNAMIC_IMPORT = /\bawait\s+import\s*\(/;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (extname(full) === '.ts') out.push(full);
  }
  return out;
}

function main() {
  const offenders: string[] = [];
  for (const root of ROOTS) {
    let files: string[];
    try {
      files = walk(root);
    } catch {
      continue; // root may not exist
    }
    for (const file of files) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (DYNAMIC_IMPORT.test(line) && !line.trimStart().startsWith('//')) {
            offenders.push(`${file}:${i + 1} — ${line.trim()}`);
          }
        });
    }
  }

  if (offenders.length > 0) {
    console.error('✗ dynamic import() in the workflow step path:\n');
    for (const o of offenders) console.error(`  ${o}`);
    console.error('\nUse a static top-level import — workflow steps bundle their imports at build time.');
    process.exit(1);
  }
  console.log('workflow-imports: no dynamic imports in the step path.');
}

main();
