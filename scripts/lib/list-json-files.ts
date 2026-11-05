import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** `[]` for a missing directory. */
export function listJsonFiles(dir: string): string[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- dir is a caller-provided workflow directory, not user input
  if (!existsSync(dir)) return [];
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- dir is a caller-provided workflow directory, not user input
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => join(dir, name));
}
