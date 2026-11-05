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
  'locale',
] as const;

/** Must match `Installer::DB_VERSION`. */
const DB_VERSION = '2';

/**
 * Excludes the three delivery keys: `setup.sh` sets them, so they differ from the defaults.
 */
const COMPARED_SETTINGS_KEYS = ['base_rates', 'per_room', 'per_km', 'extras', 'range_percent', 'routes'] as const;

/**
 * Fails with key names only: the option holds the webhook secret, which must never be printed.
 */
function expectSettingsMatch(actual: Record<string, unknown>, expected: Record<string, unknown>): void {
  const mismatched = COMPARED_SETTINGS_KEYS.filter((key) => JSON.stringify(actual[key]) !== JSON.stringify(expected[key]));
  expect(mismatched, `settings mismatch on key(s): ${mismatched.join(', ')}`).toEqual([]);
}

/** The value row plus its timeout row. */
async function rateLimitTransientRowCount(): Promise<number> {
  const rows = await sqlWp("SELECT option_name FROM wp_options WHERE option_name LIKE '%moving_quote_rl_test%'");
  return rows.length;
}

async function leadsTableExists(): Promise<boolean> {
  const leadsTable = await table();
  const [row] = await sqlWp(`SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = '${leadsTable}'`);
  return '1' === row?.n;
}

async function cronHookScheduled(): Promise<boolean> {
  const events = await wpJson<{ hook: string }[]>(['cron', 'event', 'list', '--fields=hook']);
  return events.some((event) => 'moving_quote_process_outbox' === event.hook);
}

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

  it('activation runs to completion on a single-site install regardless of the network_wide argument', async () => {
    // The refusal checks is_multisite(); faking MULTISITE breaks WP-CLI without the multisite
    // tables, so only this half is testable: $network_wide alone never triggers it.
    await wp(['eval', 'delete_option( "moving_quote_db_version" ); delete_option( "moving_quote_settings" );']);
    await wp(['eval', '\\Chivabox\\MovingQuote\\Install\\Installer::activate( true );']);
    await expect(wp(['option', 'get', 'moving_quote_db_version'])).resolves.toBe(`${DB_VERSION}\n`);
  });

  it('seeds moving_quote_settings with the pricing defaults', async () => {
    const stored = await wpJson<Record<string, unknown>>(['option', 'get', 'moving_quote_settings']);
    const defaults = await pricingDefaults();
    expectSettingsMatch(stored, defaults);
  });

  it('sets the db version and schedules the outbox cron every minute', async () => {
    await expect(wp(['option', 'get', 'moving_quote_db_version'])).resolves.toBe(`${DB_VERSION}\n`);
    await expect(cronHookScheduled()).resolves.toBe(true);

    const schedules = await wpJson<{ name: string; interval: number }[]>(['cron', 'schedule', 'list']);
    const everyMinute = schedules.find((schedule) => 'moving_quote_every_minute' === schedule.name);
    expect(everyMinute?.interval).toBe(60);
  });

  it('an upgrade from schema version 1 adds the locale column without touching existing rows', async () => {
    const leadsTable = await table();
    const uuid = '22222222-2222-4222-8222-222222222222';
    // A version-1 table: no locale column, and a row saved under it.
    await sqlWp(`ALTER TABLE ${leadsTable} DROP COLUMN locale`);
    await sqlWp(
      `INSERT INTO ${leadsTable}
        (request_uuid, created_at, move_type, rooms, origin_city, destination_city, distance_km, move_date, customer_name, phone, email, consent_at, estimate_cop, estimate_low_cop, estimate_high_cop)
       VALUES
        ('${uuid}', '2026-11-01 00:00:00', 'apartment', 2, 'Barranquilla', 'Cartagena', 120, '2026-11-20', 'Upgrade Customer', '5700000000', 'upgrade@example.com', '2026-11-01 00:00:00', 1130000, 1017000, 1243000)`,
    );
    await wp(['option', 'update', 'moving_quote_db_version', '1']);

    // The next request's plugins_loaded runs maybe_upgrade(), which reruns dbDelta.
    await wp(['option', 'get', 'siteurl']);

    await expect(wp(['option', 'get', 'moving_quote_db_version'])).resolves.toBe(`${DB_VERSION}\n`);
    const columns = await sqlWp(`SHOW COLUMNS FROM ${leadsTable}`);
    expect(columns.map((row) => row.Field)).toEqual([...CONTRACT_COLUMNS]);
    const rows = await sqlWp(`SELECT customer_name, locale FROM ${leadsTable} WHERE request_uuid = '${uuid}'`);
    expect(rows).toEqual([{ customer_name: 'Upgrade Customer', locale: '' }]);
    await sqlWp(`DELETE FROM ${leadsTable} WHERE request_uuid = '${uuid}'`);
  });

  it('an in-place upgrade (no re-activation) also seeds the settings and the cron', async () => {
    // A site active before this version: only maybe_upgrade() can repair it. One wp eval, since
    // every separate wp command fires plugins_loaded and would repair state between removals.
    await wp(['eval', 'delete_option( "moving_quote_db_version" ); delete_option( "moving_quote_settings" ); wp_clear_scheduled_hook( "moving_quote_process_outbox" );']);

    // The next wp command is the first to see it all gone, and runs the repair.
    await wp(['option', 'get', 'siteurl']);

    await expect(wp(['option', 'get', 'moving_quote_db_version'])).resolves.toBe(`${DB_VERSION}\n`);
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

  it('uninstall drops the table, both options, the rate-limit transient, the rate-limited-submissions counter, and the cron hook', async () => {
    await wp(['transient', 'set', 'moving_quote_rl_test', '1', '600']);
    await expect(rateLimitTransientRowCount()).resolves.toBe(2);

    await wp(['transient', 'set', 'moving_quote_rate_limited_submissions', '1', '600']);
    const counterRowsBefore = await sqlWp("SELECT option_name FROM wp_options WHERE option_name LIKE '%moving_quote_rate_limited_submissions%'");
    expect(counterRowsBefore).toHaveLength(2); // the value row and its timeout row

    await wp(['plugin', 'uninstall', 'moving-quote', '--deactivate', '--skip-delete']);

    await expect(leadsTableExists()).resolves.toBe(false);
    await expect(wp(['option', 'get', 'moving_quote_settings'])).rejects.toThrow();
    await expect(wp(['option', 'get', 'moving_quote_db_version'])).rejects.toThrow();
    await expect(rateLimitTransientRowCount()).resolves.toBe(0);
    const counterRowsAfter = await sqlWp("SELECT option_name FROM wp_options WHERE option_name LIKE '%moving_quote_rate_limited_submissions%'");
    expect(counterRowsAfter).toHaveLength(0);
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
