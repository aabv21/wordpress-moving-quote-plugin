import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

export interface ReceivedRequest {
  headers: Record<string, string>;
  body: string;
}

export interface Receiver {
  /** `http://host.docker.internal:<port>/lead` — reachable from the stack's own containers, which all declare that host via `extra_hosts`. */
  url: string;
  requests: ReceivedRequest[];
  /** Sets the status, body, and extra headers the next received request (and every one after it, until changed again) gets answered with. */
  reply(status: number, body: string, headers?: Record<string, string>): void;
  close(): Promise<void>;
}

function headerRecord(raw: IncomingMessage['headers']): Record<string, string> {
  const record: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string') record[key] = value;
    else if (Array.isArray(value)) record[key] = value.join(', ');
  }
  return record;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}

/**
 * A tiny HTTP server standing in for n8n's webhook, listening on `0.0.0.0` on an ephemeral port so
 * the WordPress, wpcli, and cron containers (every one declares `host.docker.internal` through
 * `extra_hosts`) can reach it, on Linux CI runners too.
 */
export async function startReceiver(): Promise<Receiver> {
  const requests: ReceivedRequest[] = [];
  let status = 200;
  let body = '{"status":"accepted"}';
  let extraHeaders: Record<string, string> = {};

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const receivedBody = await readBody(req);
      requests.push({ headers: headerRecord(req.headers), body: receivedBody });
      res.writeHead(status, { 'Content-Type': 'application/json', ...extraHeaders });
      res.end(body);
    })();
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '0.0.0.0', resolve);
  });

  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('receiver did not bind to a TCP port');
  const port = address.port;

  return {
    url: `http://host.docker.internal:${String(port)}/lead`,
    requests,
    reply(newStatus: number, newBody: string, newHeaders?: Record<string, string>): void {
      status = newStatus;
      body = newBody;
      extraHeaders = newHeaders ?? {};
    },
    close(): Promise<void> {
      return new Promise((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
  };
}
