import { execFile } from 'node:child_process';

/**
 * Runs `docker compose <args>`, optionally writing `input` to the child's stdin, and resolves
 * with its stdout. `execFile`'s own options have no `input` field (that exists only on the
 * `*Sync` functions), so `input` is written to the returned child's stdin stream by hand.
 */
export function compose(args: string[], input?: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = execFile('docker', ['compose', ...args], { maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err instanceof Error ? err : new Error(err.message));
      else resolve(stdout);
    });
    if (input !== undefined) child.stdin?.end(input);
  });
}
