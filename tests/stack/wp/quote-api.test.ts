import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { deleteCreatedLeads, validLead } from '../lib/leads.ts';
import { clearDebugLog, disableDelivery, pluginLogLines, resetRateLimits, rest, restNonce, sqlWp, table, wp } from '../lib/stack.ts';

interface EstimateBody {
  amount: number;
  low: number;
  high: number;
  distance_km: number;
  currency: string;
  display: string;
}

interface SubmitBody {
  ok: boolean;
  reference?: string;
  estimate?: EstimateBody;
}

interface WpErrorBody {
  code: string;
  message: string;
  data?: { errors?: Record<string, string> };
}

const ESTIMATE_PATH = '/moving-quote/v1/estimate';
const LEADS_PATH = '/moving-quote/v1/leads';
const OPTION_NAME = 'moving_quote_settings';

async function countLeadRows(): Promise<number> {
  const rows = await sqlWp(`SELECT COUNT(*) AS n FROM ${await table()}`);
  return Number(rows[0]?.n ?? 0);
}

/**
 * The hashed suffix `RateLimiter` computes for the test runner's own client IP, read back from
 * the `submit` bucket's transient row after one real request has created it. The hash depends
 * only on the IP and `wp_salt('nonce')`, not the bucket name, so this same suffix also names the
 * `estimate` bucket's transient for the same client.
 */
async function submitBucketHash(): Promise<string> {
  const rows = await sqlWp("SELECT option_name FROM wp_options WHERE option_name LIKE '_transient_moving_quote_rl_submit_%'");
  const optionName = rows[0]?.option_name;
  if (optionName === undefined || optionName === null) throw new Error('no submit rate-limit transient found; make one real submit request first');
  return optionName.replace('_transient_moving_quote_rl_submit_', '');
}

describe('quote and lead REST API', () => {
  let nonce: string;
  let restoreDelivery: () => Promise<void>;

  // Registered first, so its afterAll (below) is the last one to run (afterAll hooks run in
  // reverse registration order): every other restore in this file must settle before this one
  // puts the real webhook_url back, including the per_km test's own settings restore, whose
  // captured "before" snapshot holds the '' this sets.
  beforeAll(async () => {
    restoreDelivery = await disableDelivery();
  });
  afterAll(async () => {
    await restoreDelivery();
  });

  beforeAll(async () => {
    nonce = await restNonce();
  });

  afterEach(async () => {
    await resetRateLimits();
  });

  afterAll(async () => {
    // Every lead this suite inserts is a real delivery attempt once delivery is configured, and
    // cron keeps retrying a pending one for hours; none of them must outlive this file.
    await deleteCreatedLeads();
  });

  describe('estimate', () => {
    it('brief 1: apartment, 2 rooms, Barranquilla to Cartagena, no extras', async () => {
      const res = await rest(ESTIMATE_PATH, { move_type: 'apartment', rooms: 2, origin: 'Barranquilla', destination: 'Cartagena', extras: [] });
      expect(res.status).toBe(200);
      expect(res.json).toEqual({
        amount: 1130000,
        low: 1017000,
        high: 1243000,
        distance_km: 120,
        currency: 'COP',
        display: 'COP 1,017,000 – 1,243,000',
      });
    });

    it('brief 2: house, 4 rooms, Cartagena to Santa Marta, every extra', async () => {
      const res = await rest(ESTIMATE_PATH, {
        move_type: 'house',
        rooms: 4,
        origin: 'Cartagena',
        destination: 'Santa Marta',
        extras: ['packing', 'furniture_assembly', 'storage', 'piano_fragile'],
      });
      expect(res.status).toBe(200);
      const body = res.json as EstimateBody;
      expect(body.amount).toBe(2880000);
      expect(body.low).toBe(2592000);
      expect(body.high).toBe(3168000);
    });

    it('brief 6: a per_km change is reflected immediately', async () => {
      const before = await wp(['option', 'get', OPTION_NAME, '--format=json']);
      try {
        await wp(['option', 'patch', 'update', OPTION_NAME, 'per_km', '5000', '--format=json']);

        const res = await rest(ESTIMATE_PATH, { move_type: 'apartment', rooms: 2, origin: 'Barranquilla', destination: 'Cartagena', extras: [] });
        expect(res.status).toBe(200);
        const body = res.json as EstimateBody;
        expect(body.amount).toBe(1250000);
        expect(body.display).toBe('COP 1,125,000 – 1,375,000');
      } finally {
        await wp(['option', 'update', OPTION_NAME, before, '--format=json']);
      }
    });

    it('rejects an out-of-range rooms value with the field message', async () => {
      const res = await rest(ESTIMATE_PATH, { move_type: 'apartment', rooms: 9, origin: 'Barranquilla', destination: 'Cartagena', extras: [] });
      expect(res.status).toBe(422);
      const body = res.json as WpErrorBody;
      expect(body.code).toBe('moving_quote_invalid');
      expect(body.data?.errors?.rooms).toBe('Please check this value.');
    });

    it('rejects an unknown city with the field message', async () => {
      const res = await rest(ESTIMATE_PATH, { move_type: 'apartment', rooms: 2, origin: 'Bogotá', destination: 'Cartagena', extras: [] });
      expect(res.status).toBe(422);
      const body = res.json as WpErrorBody;
      expect(body.code).toBe('moving_quote_invalid');
      expect(body.data?.errors?.origin).toBe('Choose a city from the list.');
    });
  });

  describe('submit', () => {
    it('saves a valid lead and returns 201 with the reference and estimate', async () => {
      const lead = validLead();
      const res = await rest(LEADS_PATH, lead, { nonce });
      expect(res.status).toBe(201);
      const body = res.json as SubmitBody;
      expect(body.ok).toBe(true);
      expect(body.reference).toMatch(/^MQ-[0-9A-F]{8}$/);
      expect(body.estimate).toEqual({
        amount: 1130000,
        low: 1017000,
        high: 1243000,
        distance_km: 120,
        currency: 'COP',
        display: 'COP 1,017,000 – 1,243,000',
      });

      const rows = await sqlWp(`SELECT status, sync_status, estimate_cop, consent_at FROM ${await table()} WHERE request_uuid = '${lead.submission_id as string}'`);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe('new');
      expect(rows[0]?.sync_status).toBe('pending');
      expect(rows[0]?.estimate_cop).toBe('1130000');
      expect(rows[0]?.consent_at).not.toBeNull();
    });

    it('ignores a forged price from the client and stores the server-computed estimate', async () => {
      const lead = validLead({ estimate: 1, amount: 1 });
      const res = await rest(LEADS_PATH, lead, { nonce });
      expect(res.status).toBe(201);

      const rows = await sqlWp(`SELECT estimate_cop FROM ${await table()} WHERE request_uuid = '${lead.submission_id as string}'`);
      expect(rows[0]?.estimate_cop).toBe('1130000');
    });

    it('rejects a request with no nonce and saves nothing', async () => {
      const before = await countLeadRows();
      const lead = validLead();
      const res = await rest(LEADS_PATH, lead);
      expect(res.status).toBe(403);
      const body = res.json as WpErrorBody;
      expect(body.code).toBe('moving_quote_bad_nonce');

      const after = await countLeadRows();
      expect(after).toBe(before);
    });

    it('rejects a stale or forged nonce with the core cookie-check code', async () => {
      const lead = validLead();
      const res = await rest(LEADS_PATH, lead, { nonce: 'not-a-real-nonce' });
      expect(res.status).toBe(403);
      const body = res.json as WpErrorBody;
      expect(body.code).toBe('rest_cookie_invalid_nonce');
    });

    it('brief 5: a filled honeypot returns 201 ok and saves nothing', async () => {
      const before = await countLeadRows();
      const lead = validLead({ website: 'http://spam.example' });
      const res = await rest(LEADS_PATH, lead, { nonce });
      expect(res.status).toBe(201);
      expect(res.json).toEqual({ ok: true });

      const after = await countLeadRows();
      expect(after).toBe(before);
    });

    it('stores a unicode name exactly', async () => {
      const lead = validLead({ name: 'José Peña' });
      const res = await rest(LEADS_PATH, lead, { nonce });
      expect(res.status).toBe(201);

      const rows = await sqlWp(`SELECT customer_name FROM ${await table()} WHERE request_uuid = '${lead.submission_id as string}'`);
      expect(rows[0]?.customer_name).toBe('José Peña');
    });

    it('rejects a bad field with 422 moving_quote_invalid, not a core 400', async () => {
      const lead = validLead({ rooms: 9 });
      const res = await rest(LEADS_PATH, lead, { nonce });
      expect(res.status).toBe(422);
      const body = res.json as WpErrorBody;
      expect(body.code).toBe('moving_quote_invalid');
      expect(body.data?.errors?.rooms).toBe('Please check this value.');
    });

    it('a duplicate submission (same submission_id) is idempotent: one row, same reference, back to back and in parallel', async () => {
      const first = validLead();
      const res1 = await rest(LEADS_PATH, first, { nonce });
      const res2 = await rest(LEADS_PATH, first, { nonce });
      expect(res1.status).toBeLessThan(300);
      expect(res2.status).toBeLessThan(300);
      const body1 = res1.json as SubmitBody;
      const body2 = res2.json as SubmitBody;
      expect(body2.reference).toBe(body1.reference);

      const rows1 = await sqlWp(`SELECT id FROM ${await table()} WHERE request_uuid = '${first.submission_id as string}'`);
      expect(rows1).toHaveLength(1);

      const second = validLead();
      const [resA, resB] = await Promise.all([rest(LEADS_PATH, second, { nonce }), rest(LEADS_PATH, second, { nonce })]);
      expect(resA.status).toBeLessThan(300);
      expect(resB.status).toBeLessThan(300);
      const bodyA = resA.json as SubmitBody;
      const bodyB = resB.json as SubmitBody;
      expect(bodyA.reference).toBe(bodyB.reference);

      const rows2 = await sqlWp(`SELECT id FROM ${await table()} WHERE request_uuid = '${second.submission_id as string}'`);
      expect(rows2).toHaveLength(1);
    });

    it('rate limits submit: five succeed, the sixth gets 429 with Retry-After', async () => {
      for (let i = 0; i < 5; i++) {
        const res = await rest(LEADS_PATH, validLead(), { nonce });
        expect(res.status).toBe(201);
      }
      const res = await rest(LEADS_PATH, validLead(), { nonce });
      expect(res.status).toBe(429);
      const body = res.json as WpErrorBody;
      expect(body.code).toBe('moving_quote_rate_limited');
      expect(res.headers.get('Retry-After')).not.toBeNull();
    });

    it('five invalid submissions never count against the submit limit, so a valid one after them still succeeds', async () => {
      for (let i = 0; i < 5; i++) {
        const res = await rest(LEADS_PATH, validLead({ phone: 'not-a-phone' }), { nonce });
        expect(res.status).toBe(422);
      }
      const res = await rest(LEADS_PATH, validLead(), { nonce });
      expect(res.status).toBe(201);
    });

    it('a duplicate submission does not count against the submit limit', async () => {
      const lead = validLead();
      for (let i = 0; i < 5; i++) {
        const res = await rest(LEADS_PATH, lead, { nonce });
        expect(res.status).toBeLessThan(300);
      }
      // All five above were the same submission_id, so only the first inserted; the other four
      // were duplicates and must not have consumed the limit either.
      const res = await rest(LEADS_PATH, validLead(), { nonce });
      expect(res.status).toBe(201);
    });

    it('a genuine concurrent burst never lets more than the limit through', async () => {
      // Six requests fired at once race each other for the same transient row. Without the named
      // lock, a burst like this can all read the same pre-increment count and all pass; with it,
      // each waits its turn for the tiny read-check-write section, so at most five succeed.
      const statuses = await Promise.all(Array.from({ length: 6 }, () => rest(LEADS_PATH, validLead(), { nonce }).then((res) => res.status)));
      const succeeded = statuses.filter((status) => 201 === status);
      const limited = statuses.filter((status) => 429 === status);
      expect(succeeded).toHaveLength(5);
      expect(limited).toHaveLength(1);
    });

    it('fails closed when the rate limiter cannot acquire its lock', async () => {
      // Seed the submit bucket's transient with one real request, so its hashed key (derived only
      // from this client's IP) can be read back and reused as the MySQL named-lock key.
      const seeded = await rest(LEADS_PATH, validLead(), { nonce });
      expect(seeded.status).toBe(201);
      const hash = await submitBucketHash();
      const lockKey = `moving_quote_rl_submit_${hash}`;

      // Hold that exact lock from a second, independent MySQL connection for longer than the
      // limiter's own 2 s timeout, simulating another request already updating this bucket.
      const holderScript = `
<?php
global $wpdb;
$got = $wpdb->get_var( $wpdb->prepare( 'SELECT GET_LOCK(%s, 2)', $args[0] ) );
if ( '1' !== $got ) {
	fwrite( STDERR, "holder failed to acquire its own lock: " . var_export( $got, true ) . "\\n" );
	exit( 1 );
}
sleep( 4 );
$wpdb->get_var( $wpdb->prepare( 'SELECT RELEASE_LOCK(%s)', $args[0] ) );
`;
      const holderPromise = wp(['eval-file', '-', lockKey], holderScript);

      // Give the holder time to actually acquire the lock before racing it.
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const before = await countLeadRows();
      const started = Date.now();
      const blocked = await rest(LEADS_PATH, validLead(), { nonce });
      const elapsedMs = Date.now() - started;

      await holderPromise;

      expect(blocked.status).toBe(429);
      const body = blocked.json as WpErrorBody;
      expect(body.code).toBe('moving_quote_rate_limited');
      expect(blocked.headers.get('Retry-After')).toBe('2');
      // The failed-lock wait (2 s) is itself proof this went through the fail-closed branch and
      // not the ordinary over-limit branch, which returns instantly.
      expect(elapsedMs).toBeGreaterThanOrEqual(1900);

      const after = await countLeadRows();
      expect(after).toBe(before);
    });

    it("MySQL's GET_LOCK returns the string '1' on success, which the rate limiter's lock check must keep accepting", async () => {
      // RateLimiter::acquire_lock() counts only '1' (MySQL) and '1=1' (Playground's SQLite
      // translator) as granted; this pins the real MySQL value.
      const script = `
<?php
global $wpdb;
echo $wpdb->get_var( $wpdb->prepare( 'SELECT GET_LOCK(%s, %d)', 'moving-quote-test-lock', 2 ) );
`;
      const stdout = await wp(['eval-file', '-'], script);
      expect(stdout.trim()).toBe('1');

      const release = `
<?php
global $wpdb;
$wpdb->get_var( $wpdb->prepare( 'SELECT RELEASE_LOCK(%s)', 'moving-quote-test-lock' ) );
`;
      await wp(['eval-file', '-'], release);
    });
  });

  it('a non-duplicate insert failure returns 500 moving_quote_save_failed and logs a PII-free line', async () => {
    const leadsTable = await table();
    const renamedTable = `${leadsTable}_renamed`;
    await sqlWp(`RENAME TABLE ${leadsTable} TO ${renamedTable}`);
    try {
      const lead = validLead();
      const res = await rest(LEADS_PATH, lead, { nonce });
      expect(res.status).toBe(500);
      const body = res.json as WpErrorBody;
      expect(body.code).toBe('moving_quote_save_failed');

      const lines = await pluginLogLines();
      const failureLines = lines.filter((line) => line.includes('lead insert failed'));
      expect(failureLines).toHaveLength(1);
      expect(failureLines[0]).not.toContain(lead.phone as string);
      expect(failureLines[0]).not.toContain(lead.email as string);
    } finally {
      await sqlWp(`RENAME TABLE ${renamedTable} TO ${leadsTable}`);
      await clearDebugLog();
    }
  });

  it('logs nothing from the plugin', async () => {
    await expect(pluginLogLines()).resolves.toEqual([]);
  });
});
