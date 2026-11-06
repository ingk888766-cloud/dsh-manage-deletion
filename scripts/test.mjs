/**
 * One-process test runner.
 *
 * `node --test` spawns a child per file; some sandboxed hosts refuse that spawn
 * (EPERM). Importing the test files in one process runs the same node:test
 * suites without spawning anything, and the process exit code still reflects
 * failures.
 */
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const testDir = join(here, '..', 'test');
const files = readdirSync(testDir).filter((file) => file.endsWith('.test.mjs')).sort();

if (files.length === 0) {
  console.error('no test files found');
  process.exit(1);
}

for (const file of files) {
  await import(pathToFileURL(join(testDir, file)).href);
}
