import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { clearDebugLog, pluginLogLines, sqlWp, table, wp, wpJson } from '../lib/stack.ts';

const execFileAsync = promisify(execFile);

/** The leads table's columns, in the contract's exact order. */
const CONTRACT_COLUMNS = [
  'id',
  'request_uuid',
  'created_at',
  'status',
  'move_type',
  'rooms',
  'origin_city',
  'destination_city',
  'distance_km',
  'move_date',
  'extras',
  'customer_name',
  'phone',
  'email',
  'consent_at',
  'estimate_cop',
  'estimate_low_cop',
  'estimate_high_cop',
  'sync_status',
  'attempts',
  'next_attempt_at',
  'last_error',
  'sent_at',
] as const;

/**
 * Settings keys this test compares between the stored option and `Defaults::settings()`. Once a
 * later task's `setup.sh` starts writing `webhook_url`, `webhook_secret`, and `team_email`, those
 * three keys come out of this list rather than out of the comparison function, so the amendment
 * is a one-line change.
 */
const COMPARED_SETTINGS_KEYS = ['base_rates', 'per_room', 'per_km', 'extras', 'range_percent', 'routes', 'webhook_url', 'webhook_secret', 'team_email'] as const;

/**
 * Asserts `actual` matches `expected` on every key in `COMPARED_SETTINGS_KEYS`, failing with only
 * the names of the mismatching keys. The option holds the webhook secret from a later task on, so
 * a failure here must never print either side's full value.
 */
function expectSettingsMatch(actual: Record<string, unknown>, expected: Record<string, unknown>): void {
  const mismatched = COMPARED_SETTINGS_KEYS.filter((key) => JSON.stringify(actual[key]) !== JSON.stringify(expected[key]));
  expect(mismatched, `settings mismatch on key(s): ${mismatched.join(', ')}`).toEqual([]);
}

/** Row count for `moving_quote_rl_test`'s two option rows (value + timeout), read straight from `wp_options`. */
async function rateLimitTransientRowCount(): Promise<number> {
  const rows = await sqlWp("SELECT option_name FROM wp_options WHERE option_name LIKE '%moving_quote_rl_test%'");
  return rows.length;
}

/** Whether the leads table currently exists in the WordPress database. */
async function leadsTableExists(): Promise<boolean> {
  const leadsTable = await table();
  const [row] = await sqlWp(`SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = '${leadsTable}'`);
  return '1' === row?.n;
}

async function cronHookScheduled(): Promise<boolean> {
  const events = await wpJson<{ hook: string }[]>(['cron', 'event', 'list', '--fields=hook']);
  return events.some((event) => 'moving_quote_process_outbox' === event.hook);
}

/** Reads `Settings\Defaults::settings()` straight from PHP, as the install's own source of truth. */
async function pricingDefaults(): Promise<Record<string, unknown>> {
  const stdout = await wp(['eval', 'echo json_encode( \\Chivabox\\MovingQuote\\Settings\\Defaults::settings() );']);
  return JSON.parse(stdout) as Record<string, unknown>;
}

describe('install lifecycle: leads table, settings, cron, upgrade, uninstall', () => {
  it('activation creates the leads table with the contract columns and indexes', async () => {
    await clearDebugLog();

    // Force a real inactive-to-active transition, so register_activation_hook's callback runs
    // instead of being a no-op on an already-active plugin.
    await wp(['plugin', 'deactivate', 'moving-quote']);
    await wp(['plugin', 'activate', 'moving-quote']);

    const columns = await sqlWp(`SHOW COLUMNS FROM ${await table()}`);
    expect(columns.map((row) => row.Field)).toEqual([...CONTRACT_COLUMNS]);

    const indexRows = await sqlWp(`SHOW INDEX FROM ${await table()}`);
    const indexNames = new Set(indexRows.map((row) => row.Key_name));
    expect(indexNames.has('request_uuid')).toBe(true);
    expect(indexNames.has('status_created')).toBe(true);
    expect(indexNames.has('sync_due')).toBe(true);
    const uuidIndex = indexRows.find((row) => 'request_uuid' === row.Key_name);
    expect(uuidIndex?.Non_unique).toBe('0');
  });

  it('seeds moving_quote_settings with the pricing defaults', async () => {
    const stored = await wpJson<Record<string, unknown>>(['option', 'get', 'moving_quote_settings']);
    const defaults = await pricingDefaults();
    expectSettingsMatch(stored, defaults);
  });

  it('sets the db version and schedules the outbox cron every minute', async () => {
    await expect(wp(['option', 'get', 'moving_quote_db_version'])).resolves.toBe('1\n');
    await expect(cronHookScheduled()).resolves.toBe(true);

    const schedules = await wpJson<{ name: string; interval: number }[]>(['cron', 'schedule', 'list']);
    const everyMinute = schedules.find((schedule) => 'moving_quote_every_minute' === schedule.name);
    expect(everyMinute?.interval).toBe(60);
  });

  it('an in-place upgrade (no re-activation) also seeds the settings and the cron', async () => {
    // Simulates a site that was already active before this version shipped: activate() never
    // runs again, so plugins_loaded's maybe_upgrade() is the only thing that can repair it.
    // All three removals run inside one wp eval call, so none of them individually triggers
    // maybe_upgrade() to repair state before the others have a chance to run: each separate wp
    // command boots WordPress and fires plugins_loaded before that command's own CLI logic runs,
    // so deleting the version option through three separate wp commands would let the first
    // deletion's own plugins_loaded cycle recreate the settings and the cron before the other two
    // commands ever execute.
    await wp(['eval', 'delete_option( "moving_quote_db_version" ); delete_option( "moving_quote_settings" ); wp_clear_scheduled_hook( "moving_quote_process_outbox" );']);

    // A separate, later wp command is the first to see every piece of state gone, and is what
    // actually exercises plugins_loaded's maybe_upgrade() repair path.
    await wp(['option', 'get', 'siteurl']);

    await expect(wp(['option', 'get', 'moving_quote_db_version'])).resolves.toBe('1\n');
    await expect(cronHookScheduled()).resolves.toBe(true);

    const stored = await wpJson<Record<string, unknown>>(['option', 'get', 'moving_quote_settings']);
    const defaults = await pricingDefaults();
    expectSettingsMatch(stored, defaults);
  });

  it('deactivation keeps the table and the settings, and clears the cron hook', async () => {
    const leadsTable = await table();
    await sqlWp(
      `INSERT INTO ${leadsTable}
        (request_uuid, created_at, move_type, rooms, origin_city, destination_city, distance_km, move_date, customer_name, phone, email, consent_at, estimate_cop, estimate_low_cop, estimate_high_cop)
       VALUES
        ('11111111-1111-4111-8111-111111111111', '2026-11-01 00:00:00', 'apartment', 2, 'Barranquilla', 'Cartagena', 120, '2026-11-20', 'Test Customer', '5700000000', 'test@example.com', '2026-11-01 00:00:00', 1130000, 1017000, 1243000)`,
    );

    await wp(['option', 'patch', 'update', 'moving_quote_settings', 'per_km', '4321', '--format=json']);

    await wp(['plugin', 'deactivate', 'moving-quote']);

    const rows = await sqlWp(`SELECT estimate_cop FROM ${leadsTable} WHERE request_uuid = '11111111-1111-4111-8111-111111111111'`);
    expect(rows[0]?.estimate_cop).toBe('1130000');

    await expect(wp(['option', 'get', 'moving_quote_settings'])).resolves.not.toHaveLength(0);
    await expect(cronHookScheduled()).resolves.toBe(false);
  });

  it('reactivation restores the cron hook without touching the row or the patched setting', async () => {
    await wp(['plugin', 'activate', 'moving-quote']);

    await expect(cronHookScheduled()).resolves.toBe(true);

    const leadsTable = await table();
    const rows = await sqlWp(`SELECT estimate_cop FROM ${leadsTable} WHERE request_uuid = '11111111-1111-4111-8111-111111111111'`);
    expect(rows[0]?.estimate_cop).toBe('1130000');

    const settings = await wpJson<{ per_km: number }>(['option', 'get', 'moving_quote_settings']);
    expect(settings.per_km).toBe(4321);
  });

  it('uninstall drops the table, both options, the rate-limit transient, and the cron hook', async () => {
    await wp(['transient', 'set', 'moving_quote_rl_test', '1', '600']);
    await expect(rateLimitTransientRowCount()).resolves.toBe(2);

    await wp(['plugin', 'uninstall', 'moving-quote', '--deactivate', '--skip-delete']);

    await expect(leadsTableExists()).resolves.toBe(false);
    await expect(wp(['option', 'get', 'moving_quote_settings'])).rejects.toThrow();
    await expect(wp(['option', 'get', 'moving_quote_db_version'])).rejects.toThrow();
    await expect(rateLimitTransientRowCount()).resolves.toBe(0);
    await expect(cronHookScheduled()).resolves.toBe(false);
  });

  it('setup.sh restores an active plugin, the table, and the default settings', async () => {
    await execFileAsync('./setup.sh');

    await expect(wp(['plugin', 'is-active', 'moving-quote'])).resolves.toBeDefined();
    await expect(leadsTableExists()).resolves.toBe(true);

    const stored = await wpJson<Record<string, unknown>>(['option', 'get', 'moving_quote_settings']);
    const defaults = await pricingDefaults();
    expectSettingsMatch(stored, defaults);
  });

  it('logs nothing from the plugin', async () => {
    await expect(pluginLogLines()).resolves.toEqual([]);
  });
});
