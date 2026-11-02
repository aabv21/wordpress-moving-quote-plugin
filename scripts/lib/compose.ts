import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function isEnoent(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT';
}

/** Loads `.env` into `process.env`. Fails with a pointer to `.env.example` if it's missing. */
export function loadDotEnv(): void {
  try {
    process.loadEnvFile('.env');
  } catch (err) {
    if (isEnoent(err)) throw new Error('.env not found; copy .env.example to .env and fill in local values.', { cause: err });
    throw err;
  }
}

/** Matches the shape `promisify(execFile)` rejects with, so `isExecError`-style callers treat either branch of `compose` alike. */
function composeError(message: string, stdout: string, stderr: string): Error & { stdout: string; stderr: string } {
  return Object.assign(new Error(message), { stdout, stderr });
}

/**
 * Runs `docker compose <args>`. With `opts.input`, spawns the process and writes `input` to its
 * stdin instead of using execFile — needed to stream credential JSON into the n8n container
 * without ever writing it to the host filesystem (see `setup-credentials.ts`'s `IMPORT_SCRIPT` and
 * `EXPORT_SCRIPT`). A non-zero exit rejects either way.
 */
export function compose(args: readonly string[], opts?: { input?: string }): Promise<{ stdout: string; stderr: string }> {
  if (opts?.input === undefined) return execFileAsync('docker', ['compose', ...args]);
  const input = opts.input;

  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['compose', ...args]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    // Writing more than the child reads before it exits raises EPIPE here. Node treats an
    // unhandled stream 'error' as fatal and crashes the process, so this must reject instead of
    // being left to the default behavior.
    child.stdin.on('error', (err: Error) => {
      const message = `docker compose ${args.join(' ')} failed to write to stdin: ${err.message}`;
      reject(composeError(stderr ? `${message}\n${stderr}` : message, stdout, stderr));
    });
    child.on('error', (err) => {
      reject(composeError(err.message, stdout, stderr));
    });
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      // Keep stderr in the message, not just on the error's own property: our CLIs print
      // err.message on failure (see import-workflows.ts/setup-credentials.ts), the same way
      // promisify(execFile)'s own "Command failed: ...\n<stderr>" does.
      else reject(composeError(`docker compose ${args.join(' ')} exited with code ${String(code)}\n${stderr}`, stdout, stderr));
    });
    child.stdin.end(input);
  });
}
