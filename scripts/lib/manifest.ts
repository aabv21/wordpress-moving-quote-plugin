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

// Filled by Tasks 11–12 with the three fixed-ID rows (lead-intake, process-lead, error-handler).
export const WORKFLOWS: readonly WorkflowEntry[] = [];

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

// Filled by Tasks 11–12 as each workflow adds its Code nodes.
export const CODE_NODES: readonly CodeNodeEntry[] = [];
