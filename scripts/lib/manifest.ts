export interface WorkflowEntry {
  id: string;
  name: string;
  file: string;
  publish: boolean;
  /** The webhook path n8n publishes this workflow's trigger at, if any. Used to poll it live after a publish. */
  webhookPath?: string;
}

export interface CredentialEntry {
  id: string;
  name: string;
  type: string;
  env: readonly string[];
  data: (env: Readonly<Record<string, string>>) => Record<string, unknown>;
}

export interface CodeNodeEntry {
  file: string;
  node: string;
  source: string;
  why: string;
}

export const ERROR_WORKFLOW_ID = 'cvbErrorHandler1';

/** `env[key]` widened past `noUncheckedIndexedAccess`; callers only reach here once the key is known to be set. */
// eslint-disable-next-line security/detect-object-injection -- key is always one of this entry's own fixed `env` names
const readEnv = (env: Readonly<Record<string, string>>, key: string): string => env[key] ?? '';

// The published workflows, each keyed by its fixed ID.
export const WORKFLOWS: readonly WorkflowEntry[] = [
  {
    id: 'cvbLeadIntake001',
    name: 'Lead intake',
    file: 'lead-intake.json',
    publish: true,
    webhookPath: 'moving-quote/leads',
  },
  {
    id: 'cvbProcessLead01',
    name: 'Process lead',
    file: 'process-lead.json',
    publish: true,
  },
  {
    id: 'cvbErrorHandler1',
    name: 'Error handler',
    file: 'error-handler.json',
    publish: true,
  },
];

export const CREDENTIALS: readonly CredentialEntry[] = [
  {
    id: 'cvbCredAppDb0001',
    name: 'App DB',
    type: 'postgres',
    env: ['APP_DB_USER', 'APP_DB_PASSWORD'],
    data: (env) => ({
      host: 'postgres',
      port: 5432,
      database: 'app',
      user: readEnv(env, 'APP_DB_USER'),
      password: readEnv(env, 'APP_DB_PASSWORD'),
      ssl: 'disable',
    }),
  },
  {
    id: 'cvbCredLeadJwt01',
    name: 'Lead webhook JWT',
    type: 'jwtAuth',
    env: ['LEAD_WEBHOOK_SECRET'],
    data: (env) => ({ keyType: 'passphrase', secret: readEnv(env, 'LEAD_WEBHOOK_SECRET'), algorithm: 'HS256' }),
  },
  {
    id: 'cvbCredGSheets01',
    name: 'Google Sheets',
    type: 'googleSheetsOAuth2Api',
    env: ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET'],
    data: (env) => ({ clientId: readEnv(env, 'GOOGLE_OAUTH_CLIENT_ID'), clientSecret: readEnv(env, 'GOOGLE_OAUTH_CLIENT_SECRET') }),
  },
  {
    id: 'cvbCredGmail0001',
    name: 'Gmail',
    type: 'gmailOAuth2',
    env: ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET'],
    data: (env) => ({ clientId: readEnv(env, 'GOOGLE_OAUTH_CLIENT_ID'), clientSecret: readEnv(env, 'GOOGLE_OAUTH_CLIENT_SECRET') }),
  },
];

// Every Code node across workflows/, each generated from its own src/nodes/*.ts source.
export const CODE_NODES: readonly CodeNodeEntry[] = [
  {
    file: 'lead-intake.json',
    node: 'Verify request',
    source: 'src/nodes/verify-request.ts',
    why: 'one tested function checks the claims, the body hash, and the payload contract instead of a chain of IF nodes',
  },
  {
    file: 'process-lead.json',
    node: 'Map lead',
    source: 'src/nodes/map-lead.ts',
    why: 'one tested function builds the sheet row and both notification emails from the same lead, instead of separate Set and expression nodes for each',
  },
];

/** Every manifest credential that reads its OAuth client from `GOOGLE_OAUTH_CLIENT_ID` — the two Google ones, by construction rather than a separately maintained id list. */
export function googleCredentialIds(credentials: readonly CredentialEntry[]): string[] {
  return credentials.filter((c) => c.env.includes('GOOGLE_OAUTH_CLIENT_ID')).map((c) => c.id);
}
