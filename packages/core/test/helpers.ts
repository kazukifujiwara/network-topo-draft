import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Absolute path of the repository root. */
export const REPO_ROOT = resolve(HERE, '../../..');

/** Read a file under fixtures/ as UTF-8 text. */
export function readFixture(relativePath: string): string {
  return readFileSync(resolve(REPO_ROOT, 'fixtures', relativePath), 'utf8');
}
