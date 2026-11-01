import { describe, expect, it } from 'vitest';
import { psqlAs, required, sqlApp } from '../lib/stack.ts';

describe('n8n and Postgres runtime', () => {
  it('reports healthy', async () => {
    const res = await fetch(`${required('N8N_URL')}/healthz`);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('keeps the app role out of the n8n database', async () => {
    await expect(psqlAs(required('APP_DB_USER'), 'n8n', 'SELECT 1')).rejects.toThrow(/permission denied for database "n8n"/);
  });

  it('keeps the n8n role out of the app database', async () => {
    await expect(psqlAs(required('N8N_DB_USER'), 'app', 'SELECT 1')).rejects.toThrow(/permission denied for database "app"/);
  });

  it('starts with an empty processed_events table', async () => {
    await expect(sqlApp('SELECT count(*) FROM processed_events')).resolves.toBe('0');
  });
});
