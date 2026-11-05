import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { listJsonFiles } from './lib/list-json-files.ts';
import { CODE_NODES, CREDENTIALS, ERROR_WORKFLOW_ID, type CodeNodeEntry } from './lib/manifest.ts';
import type { WorkflowJson, WorkflowNode } from './lib/workflow-types.ts';

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE_RE = /\d{10,}/;
const LONG_ID_RE = /[A-Za-z0-9_-]{40,}/;
const SECRET_RE = /sk-ant-|Bearer [A-Za-z0-9._-]{20,}/;
const SQL_LINE_COMMENT_RE = /--.*$/gm;
const SQL_BLOCK_COMMENT_RE = /\/\*[\s\S]*?\*\//g;
const SQL_PLACEHOLDER_RE = /\$\d/;

/**
 * n8n substitutes every `$N` in the raw query text, comments included, and only doubles `'`, so a
 * bound value with a newline can end a `--` comment and turn the rest into live SQL.
 */
export function hasPlaceholderInSqlComment(query: string): boolean {
  const comments = [...query.matchAll(SQL_LINE_COMMENT_RE), ...query.matchAll(SQL_BLOCK_COMMENT_RE)].map((m) => m[0]);
  return comments.some((comment) => SQL_PLACEHOLDER_RE.test(comment));
}

// External services that must retry instead of failing a workflow run on a transient error.
const RETRY_REQUIRED_TYPES = new Set(['n8n-nodes-base.postgres', 'n8n-nodes-base.googleSheets', 'n8n-nodes-base.gmail', 'n8n-nodes-base.httpRequest']);

/**
 * Under `gmail.send` alone, n8n 2.45.6's Gmail node can only send: `options.senderName` calls
 * `GET users/me/profile` first and gets a 403.
 */
function isSendOnlyGmailCredential(credential: { data: (env: Readonly<Record<string, string>>) => Record<string, unknown> }): boolean {
  const data = credential.data({});
  return data.customScopes === true && data.enabledScopes === 'https://www.googleapis.com/auth/gmail.send';
}

export function checkWorkflow(
  wf: WorkflowJson,
  opts: { file: string; credentialIds: ReadonlySet<string>; codeNodes: readonly CodeNodeEntry[]; credentials?: typeof CREDENTIALS },
): string[] {
  const credentials = opts.credentials ?? CREDENTIALS;
  const errors: string[] = [];
  // Widened past WorkflowJson's types, so a malformed file is reported instead of crashing.
  const raw: Record<string, unknown> = wf;

  for (const field of ['id', 'name', 'nodes', 'connections', 'settings']) {
    // eslint-disable-next-line security/detect-object-injection -- field is one of the fixed literals above
    if (raw[field] === undefined || raw[field] === null) errors.push(`missing ${field}`);
  }

  if (raw.pinData !== undefined) errors.push('pinData present');
  const meta = raw.meta;
  const instanceId = meta !== null && typeof meta === 'object' ? (meta as Record<string, unknown>).instanceId : undefined;
  if (instanceId !== undefined) errors.push('meta.instanceId present');

  const settings = raw.settings;
  if (settings !== null && typeof settings === 'object') {
    const s = settings as Record<string, unknown>;
    if (s.executionOrder !== 'v1') errors.push('settings.executionOrder must be v1');
    if (s.timezone !== 'America/Bogota') errors.push('settings.timezone must be America/Bogota');
    if (s.callerPolicy !== 'workflowsFromSameOwner') errors.push('settings.callerPolicy must be workflowsFromSameOwner');
    const isHandler = wf.id === ERROR_WORKFLOW_ID;
    if (!isHandler && s.errorWorkflow !== ERROR_WORKFLOW_ID) {
      errors.push(`settings.errorWorkflow must be ${ERROR_WORKFLOW_ID}`);
    }
  }

  const nodesValue = raw.nodes;
  const nodes = Array.isArray(nodesValue) ? (nodesValue as WorkflowNode[]) : [];
  let hasStickyNote = false;

  for (const node of nodes) {
    if (node.type === 'n8n-nodes-base.stickyNote') hasStickyNote = true;

    for (const credential of Object.values(node.credentials ?? {})) {
      if (!opts.credentialIds.has(credential.id)) errors.push(`credential ${credential.id} not in manifest`);
    }

    const serialized = JSON.stringify(node.parameters);
    if (EMAIL_RE.test(serialized)) errors.push(`literal email in node ${node.name}`);
    if (PHONE_RE.test(serialized)) errors.push(`literal phone in node ${node.name}`);
    if (LONG_ID_RE.test(serialized)) errors.push(`literal long id in node ${node.name}`);
    if (SECRET_RE.test(serialized)) errors.push(`secret-like value in node ${node.name}`);

    if (node.type === 'n8n-nodes-base.code') {
      const jsCode = typeof node.parameters.jsCode === 'string' ? node.parameters.jsCode : '';
      if (!jsCode.startsWith('// Why Code:')) errors.push(`code node ${node.name} must start with // Why Code:`);
      const hasSource = opts.codeNodes.some((e) => e.file === opts.file && e.node === node.name);
      if (!hasSource) errors.push(`code node ${node.name} has no source in the manifest`);
    }

    if (RETRY_REQUIRED_TYPES.has(node.type) && !(node.retryOnFail === true && node.maxTries === 3 && node.waitBetweenTries === 1000)) {
      errors.push(`node ${node.name} must retry 3 times with a 1000 ms wait`);
    }

    if (node.type === 'n8n-nodes-base.gmail') {
      const options = node.parameters.options;
      const hasSenderName = options !== null && typeof options === 'object' && 'senderName' in (options as Record<string, unknown>);
      if (hasSenderName) {
        const credentialId = Object.values(node.credentials ?? {})[0]?.id;
        const credential = credentials.find((c) => c.id === credentialId);
        if (credential && isSendOnlyGmailCredential(credential)) {
          errors.push(`node ${node.name} sets options.senderName, which calls GET users/me/profile — not authorized by its send-only Gmail credential`);
        }
      }
    }

    if (node.type === 'n8n-nodes-base.postgres' && node.parameters.operation === 'executeQuery') {
      const query = node.parameters.query;
      if (typeof query === 'string' && query.includes('{{')) {
        errors.push(`query in node ${node.name} must use $n parameters, not expressions`);
      }
      if (typeof query === 'string' && hasPlaceholderInSqlComment(query)) {
        errors.push(`query in node ${node.name} has a $n placeholder inside a SQL comment`);
      }
    }
  }

  if (!hasStickyNote) errors.push('workflow has no sticky notes');

  return errors;
}

function readWorkflow(path: string): WorkflowJson {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path comes from listJsonFiles over a caller-chosen directory, not user input
  return JSON.parse(readFileSync(path, 'utf8')) as WorkflowJson;
}

function main(): void {
  const dir = process.argv[2];
  if (!dir) {
    console.error('usage: node scripts/check-workflows.ts <dir>');
    process.exitCode = 1;
    return;
  }

  const credentialIds = new Set(CREDENTIALS.map((c) => c.id));
  let failed = false;
  for (const path of listJsonFiles(dir)) {
    const file = basename(path);
    const wf = readWorkflow(path);
    for (const message of checkWorkflow(wf, { file, credentialIds, codeNodes: CODE_NODES })) {
      console.log(`${path}: ${message}`);
      failed = true;
    }
  }
  if (failed) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
