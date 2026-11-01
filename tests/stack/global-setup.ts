import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function composeOutput(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('docker', ['compose', ...args]);
  return stdout;
}

async function cronIsRunning(): Promise<boolean> {
  const stdout = await composeOutput(['ps', '--status', 'running', '--services']);
  return stdout.split('\n').includes('cron');
}

/**
 * Stops the `cron` sidecar for the whole stack-test run and restarts it afterward only if it was
 * running beforehand. The outbox and `wp cron event run --due-now` loop would otherwise race the
 * tests' own assertions about delivery state and log contents.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const wasRunning = await cronIsRunning();
  if (wasRunning) await composeOutput(['stop', 'cron']);

  return async () => {
    if (wasRunning) await composeOutput(['start', 'cron']);
  };
}
