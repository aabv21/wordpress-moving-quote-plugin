import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ensureN8nImportDir, fillSecrets, writeEnvFile } from '../scripts/init-env.ts';

const example = ['# MySQL', 'MYSQL_USER=wordpress', 'MYSQL_PASSWORD=', 'N8N_ENCRYPTION_KEY=', 'LEAD_WEBHOOK_SECRET=',
  'GOOGLE_OAUTH_CLIENT_SECRET=', 'WP_ADMIN_PASSWORD=preset', ''].join('\n');

describe('fillSecrets', () => {
  it('fills empty secrets, keeps everything else', () => {
    let n = 0;
    expect(fillSecrets(example, () => `hex${String(++n)}`)).toBe(['# MySQL', 'MYSQL_USER=wordpress', 'MYSQL_PASSWORD=hex1',
      'N8N_ENCRYPTION_KEY=hex2', 'LEAD_WEBHOOK_SECRET=hex3', 'GOOGLE_OAUTH_CLIENT_SECRET=', 'WP_ADMIN_PASSWORD=preset', ''].join('\n'));
  });
});

describe('writeEnvFile', () => {
  it('writes .env atomically at mode 0600, even over a stale, looser-mode temp file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cvb-env-'));
    try {
      const path = join(dir, '.env');
      // A crashed prior run can leave `.env.tmp` behind at whatever mode it was created with.
      // `writeFileSync`'s `{ mode }` option only applies when the file doesn't already exist, so
      // without the defensive chmod this stale file would keep its looser mode.
      writeFileSync(`${path}.tmp`, 'stale', { mode: 0o644 });
      writeEnvFile(path, 'A=1\nN8N_ENCRYPTION_KEY=secret\n');
      expect(readFileSync(path, 'utf8')).toBe('A=1\nN8N_ENCRYPTION_KEY=secret\n');
      expect(statSync(path).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

describe('ensureN8nImportDir', () => {
  it('creates the directory at mode 0700 when missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cvb-import-'));
    try {
      const target = join(dir, '.n8n-import');
      ensureN8nImportDir(target);
      expect(statSync(target).isDirectory()).toBe(true);
      expect(statSync(target).mode & 0o777).toBe(0o700);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('leaves an existing directory and its contents alone', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cvb-import-'));
    try {
      const target = join(dir, '.n8n-import');
      mkdirSync(target, { mode: 0o755 });
      writeFileSync(join(target, 'kept.json'), '{}');
      ensureN8nImportDir(target);
      expect(readFileSync(join(target, 'kept.json'), 'utf8')).toBe('{}');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});
