import { execFile } from 'node:child_process';

/** `execFile` has no `input` option (only the `*Sync` functions do), so stdin is written by hand. */
export function compose(args: string[], input?: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = execFile('docker', ['compose', ...args], { maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err instanceof Error ? err : new Error(err.message));
      else resolve(stdout);
    });
    if (input !== undefined) child.stdin?.end(input);
  });
}
