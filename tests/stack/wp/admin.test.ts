import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteCreatedLeads, validLead } from '../lib/leads.ts';
import { disableDelivery, login, pluginLogLines, required, resetRateLimits, rest, restNonce, site, sqlWp, table, wp } from '../lib/stack.ts';

const LEADS_PATH = '/moving-quote/v1/leads';
const LEADS_PAGE = '/wp-admin/admin.php?page=moving-quote';
const DASHBOARD_PAGE = '/wp-admin/index.php';
const SUBSCRIBER_LOGIN = 'moving-quote-leads-subscriber';
const STUCK_NOTICE_TEXT = 'have not reached n8n yet';

interface LeadRow {
  id: string;
  status: string;
  sync_status: string;
  attempts: string;
}

/** Mirrors `LeadRecord::reference()`. */
function referenceFor(requestUuid: string): string {
  return `MQ-${requestUuid.replaceAll('-', '').slice(0, 8).toUpperCase()}`;
}

/** Drops a leading UTF-8 BOM, read by code point rather than embedding the character in source. */
function stripBom(text: string): string {
  return 0xfeff === text.codePointAt(0) ? text.slice(1) : text;
}

function scrapeHref(html: string, linkText: string): string {
  const linkPattern = /<a href=(["'])(.*?)\1[^>]*>([^<]*)<\/a>/g;
  for (const match of html.matchAll(linkPattern)) {
    if (match[3]?.trim() === linkText) return match[2]!.replaceAll('&#038;', '&').replaceAll('&amp;', '&');
  }
  throw new Error(`no link with text "${linkText}" found in the given HTML`);
}

/** Matched by `action=moving_quote_delete_lead` and `id=$leadId` in the URL. */
function scrapeDeleteHref(html: string, leadId: string): string {
  const linkPattern = /<a href=(["'])(.*?)\1[^>]*class="submitdelete[ "][^>]*>/g;
  for (const match of html.matchAll(linkPattern)) {
    const href = match[2]!.replaceAll('&#038;', '&').replaceAll('&amp;', '&');
    if (href.includes('action=moving_quote_delete_lead') && href.includes(`id=${leadId}`)) return href;
  }
  throw new Error(`no delete link found for lead id ${leadId}`);
}

/** The `_wpnonce` inside the `<form>` holding `name="id" value="$leadId"`. */
function scrapeStatusNonce(html: string, leadId: string): string {
  const formPattern = /<form method="post"[^>]*>[\s\S]*?<\/form>/g;
  for (const form of html.matchAll(formPattern)) {
    if (!form[0].includes(`name="id" value="${leadId}"`)) continue;
    const nonceMatch = /name="_wpnonce" value="([^"]+)"/.exec(form[0]);
    if (nonceMatch?.[1] !== undefined) return nonceMatch[1];
  }
  throw new Error(`no status-update form with a _wpnonce input found for lead id ${leadId}`);
}

/** The `_wpnonce` inside the notes `<form>` of lead `$leadId`. */
function scrapeNotesNonce(html: string, leadId: string): string {
  const formPattern = /<form method="post"[^>]*>[\s\S]*?<\/form>/g;
  for (const form of html.matchAll(formPattern)) {
    if (!form[0].includes('value="moving_quote_update_notes"') || !form[0].includes(`name="id" value="${leadId}"`)) continue;
    const nonceMatch = /name="_wpnonce" value="([^"]+)"/.exec(form[0]);
    if (nonceMatch?.[1] !== undefined) return nonceMatch[1];
  }
  throw new Error(`no notes form with a _wpnonce input found for lead id ${leadId}`);
}

/** The "Mark contacted" form of lead `$leadId`, or null when the row has none. */
function markContactedForm(html: string, leadId: string): string | null {
  const formPattern = /<form method="post"[^>]*>[\s\S]*?<\/form>/g;
  for (const form of html.matchAll(formPattern)) {
    if (form[0].includes('name="status" value="contacted"') && form[0].includes(`name="id" value="${leadId}"`)) return form[0];
  }
  return null;
}

async function countLeadRows(): Promise<number> {
  const rows = await sqlWp(`SELECT COUNT(*) AS n FROM ${await table()}`);
  return Number(rows[0]?.n ?? 0);
}

async function rowByUuid(requestUuid: string): Promise<LeadRow> {
  const rows = await sqlWp(`SELECT id, status, sync_status, attempts FROM ${await table()} WHERE request_uuid = '${requestUuid}'`);
  const row = rows[0];
  if (row === undefined) throw new Error(`no lead row found for request_uuid ${requestUuid}`);
  return row as unknown as LeadRow;
}

describe('admin: leads list, status, export, retry', () => {
  let adminCookies: string;
  let nonce: string;
  let scriptLeadUuid: string;
  let formulaLeadUuid: string;
  let plainLeadUuid: string;
  let restoreDelivery: () => Promise<void>;

  // Registered first so its afterAll runs last: no lead here may reach n8n, requeued ones included.
  beforeAll(async () => {
    restoreDelivery = await disableDelivery();
  });
  afterAll(async () => {
    await restoreDelivery();
  });

  beforeAll(async () => {
    adminCookies = await login(required('WP_ADMIN_USER'), required('WP_ADMIN_PASSWORD'));
    await resetRateLimits();
    nonce = await restNonce();

    // Seeded directly as already-stored hostile data: the list table's own escaping is what's under test.
    const leadsTable = await table();
    scriptLeadUuid = crypto.randomUUID();
    await sqlWp(
      `INSERT INTO ${leadsTable} (request_uuid, created_at, status, move_type, rooms, origin_city, destination_city, distance_km, move_date, extras, customer_name, phone, email, consent_at, estimate_cop, estimate_low_cop, estimate_high_cop, sync_status, attempts, next_attempt_at, last_error, sent_at)
       VALUES ('${scriptLeadUuid}', UTC_TIMESTAMP(), 'new', 'apartment', 2, 'Barranquilla', 'Cartagena', 120, '2026-11-20', '', '<script>alert(1)</script>', '570000000002', 'script@example.com', UTC_TIMESTAMP(), 1130000, 1017000, 1243000, 'pending', 0, 0, '', NULL)`,
    );

    const formulaLead = validLead({ name: '=HYPERLINK("http://example.com","x")' });
    const formulaRes = await rest(LEADS_PATH, formulaLead, { nonce });
    expect(formulaRes.status).toBe(201);
    formulaLeadUuid = formulaLead.submission_id as string;

    const plainLead = validLead({ name: 'Test Customer' });
    const plainRes = await rest(LEADS_PATH, plainLead, { nonce });
    expect(plainRes.status).toBe(201);
    plainLeadUuid = plainLead.submission_id as string;
  });

  afterAll(async () => {
    await sqlWp(`DELETE FROM ${await table()} WHERE request_uuid = '${scriptLeadUuid}'`);
    await deleteCreatedLeads();
  });

  it('shows 200, the All and New views with their live counts, and every seeded reference, escaping the <script> name', async () => {
    const res = await fetch(site(LEADS_PAGE), { headers: { Cookie: adminCookies } });
    expect(res.status).toBe(200);
    const html = await res.text();

    const statusCounts = await sqlWp(`SELECT status, COUNT(*) AS n FROM ${await table()} GROUP BY status`);
    const allCount = await countLeadRows();
    const newCount = Number(statusCounts.find((row) => row.status === 'new')?.n ?? 0);

    expect(html).toContain(`All <span class="count">(${String(allCount)})</span>`);
    expect(html).toContain(`New <span class="count">(${String(newCount)})</span>`);

    expect(html).toContain(referenceFor(scriptLeadUuid));
    expect(html).toContain(referenceFor(formulaLeadUuid));
    expect(html).toContain(referenceFor(plainLeadUuid));

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');

    // Every row's status <select> has its own label, naming the lead, for a screen reader.
    const plainLeadId = (await rowByUuid(plainLeadUuid)).id;
    expect(html).toContain(`<label class="screen-reader-text" for="moving-quote-status-${plainLeadId}">Status of lead ${referenceFor(plainLeadUuid)}</label>`);
    expect(html).toContain(`<select id="moving-quote-status-${plainLeadId}" name="status">`);

    // A <form> still open when the table starts would swallow the first row's status form (HTML
    // drops a nested form's start tag), so its update would never apply.
    const tableIndex = html.indexOf('<table class="wp-list-table');
    expect(tableIndex).toBeGreaterThan(-1);
    const beforeTable = html.slice(0, tableIndex);
    const opens = [...beforeTable.matchAll(/<form\b/g)].length;
    const closes = [...beforeTable.matchAll(/<\/form>/g)].length;
    expect(opens).toBe(closes);
    // The specific regression this guards: no bare <form method="get"> wrapping the whole table.
    expect(html).not.toContain('<form method="get">');
  });

  it('loads the Leads stylesheet on the Leads page only, and marks the email and Delete link', async () => {
    const leads = await (await fetch(site(LEADS_PAGE), { headers: { Cookie: adminCookies } })).text();
    expect(leads).toMatch(/<link[^>]*\bhref=["'][^"']*\/plugins\/moving-quote\/assets\/admin\.css[^"']*["']/);
    expect(leads).toMatch(/<span class="moving-quote-leads__email">[^<]+@example\.com<\/span>/);
    expect(leads).toContain('class="submitdelete moving-quote-leads__delete"');

    const settings = await (await fetch(site('/wp-admin/admin.php?page=moving-quote-settings'), { headers: { Cookie: adminCookies } })).text();
    expect(settings).not.toContain('assets/admin.css');
  });

  it('updates a lead status through the scraped per-row form, rejects a wrong nonce, filters by status, and blocks a subscriber', async () => {
    const leadId = (await rowByUuid(plainLeadUuid)).id;
    const page = await fetch(site(LEADS_PAGE), { headers: { Cookie: adminCookies } });
    const html = await page.text();
    const rowNonce = scrapeStatusNonce(html, leadId);

    const wrongNonceRes = await fetch(site('/wp-admin/admin-post.php'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: adminCookies },
      body: new URLSearchParams({ action: 'moving_quote_update_status', id: leadId, status: 'contacted', _wpnonce: 'not-a-real-nonce' }),
      redirect: 'manual',
    });
    expect(wrongNonceRes.status).toBe(403);
    expect((await rowByUuid(plainLeadUuid)).status).toBe('new');

    const res = await fetch(site('/wp-admin/admin-post.php'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: adminCookies },
      body: new URLSearchParams({ action: 'moving_quote_update_status', id: leadId, status: 'contacted', _wpnonce: rowNonce }),
      redirect: 'manual',
    });
    expect(res.status).toBe(302);
    expect((await rowByUuid(plainLeadUuid)).status).toBe('contacted');

    const filtered = await fetch(site(`${LEADS_PAGE}&status=contacted`), { headers: { Cookie: adminCookies } });
    const filteredHtml = await filtered.text();
    expect(filteredHtml).toContain(referenceFor(plainLeadUuid));
    expect(filteredHtml).not.toContain(referenceFor(formulaLeadUuid));
    expect(filteredHtml).not.toContain(referenceFor(scriptLeadUuid));

    const password = randomBytes(18).toString('hex');
    await wp(['user', 'create', SUBSCRIBER_LOGIN, `${SUBSCRIBER_LOGIN}@example.com`, '--role=subscriber', `--user_pass=${password}`]);
    try {
      const subscriberCookies = await login(SUBSCRIBER_LOGIN, password);

      const statusRes = await fetch(site('/wp-admin/admin-post.php'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: subscriberCookies },
        body: new URLSearchParams({ action: 'moving_quote_update_status', id: leadId, status: 'won', _wpnonce: rowNonce }),
        redirect: 'manual',
      });
      expect(statusRes.status).toBe(403);

      const exportRes = await fetch(site('/wp-admin/admin-post.php?action=moving_quote_export_csv'), { headers: { Cookie: subscriberCookies }, redirect: 'manual' });
      expect(exportRes.status).toBe(403);

      const retryRes = await fetch(site(`/wp-admin/admin-post.php?action=moving_quote_retry_delivery&id=${leadId}`), { headers: { Cookie: subscriberCookies }, redirect: 'manual' });
      expect(retryRes.status).toBe(403);

      const deleteRes = await fetch(site(`/wp-admin/admin-post.php?action=moving_quote_delete_lead&id=${leadId}`), { headers: { Cookie: subscriberCookies }, redirect: 'manual' });
      expect(deleteRes.status).toBe(403);

      // None of the four blocked subscriber calls changed anything.
      expect((await rowByUuid(plainLeadUuid)).status).toBe('contacted');
    } finally {
      await wp(['user', 'delete', SUBSCRIBER_LOGIN, '--yes']);
    }
  });

  it('exports the full and filtered CSV, escaping the formula-looking name', async () => {
    const page = await fetch(site(LEADS_PAGE), { headers: { Cookie: adminCookies } });
    const html = await page.text();
    const exportHref = scrapeHref(html, 'Export CSV');

    const res = await fetch(new URL(exportHref, site('/')), { headers: { Cookie: adminCookies } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/csv/);
    const disposition = res.headers.get('content-disposition');
    expect(disposition).toMatch(/filename="moving-leads-\d{4}-\d{2}-\d{2}\.csv"/);
    // Bogota's "today", not UTC's, which is tomorrow for several hours every Bogota evening.
    const bogotaToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    expect(disposition).toContain(`filename="moving-leads-${bogotaToday}.csv"`);

    const buffer = Buffer.from(await res.arrayBuffer());
    expect(buffer.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    const body = stripBom(buffer.toString('utf8'));
    expect(body.startsWith('received_at,reference,status,name,phone,email,move_date,move_type,rooms,origin,destination,distance_km,extras,estimate_cop,estimate_low_cop,estimate_high_cop,sync_status,locale,notes,date_confirmed_at')).toBe(true);
    expect(body).toContain('"\'=HYPERLINK(""http://example.com"",""x"")"');

    const contactedHref = exportHref.includes('?') ? `${exportHref}&status=contacted` : `${exportHref}?status=contacted`;
    const filteredRes = await fetch(new URL(contactedHref, site('/')), { headers: { Cookie: adminCookies } });
    expect(filteredRes.status).toBe(200);
    const filteredBody = stripBom(await filteredRes.text());
    // fputcsv() terminates each row with a plain "\n", not "\r\n".
    const lines = filteredBody.trim().split('\n');
    expect(lines).toHaveLength(2);
  });

  it('skips a row with an unparseable status instead of fataling the Leads page or the CSV export', async () => {
    const leadsTable = await table();
    const poisonUuid = crypto.randomUUID();
    await sqlWp(
      `INSERT INTO ${leadsTable} (request_uuid, created_at, status, move_type, rooms, origin_city, destination_city, distance_km, move_date, extras, customer_name, phone, email, consent_at, estimate_cop, estimate_low_cop, estimate_high_cop, sync_status, attempts, next_attempt_at, last_error, sent_at)
       VALUES ('${poisonUuid}', UTC_TIMESTAMP(), 'not-a-real-status', 'apartment', 2, 'Barranquilla', 'Cartagena', 120, '2026-11-20', '', 'Poison Row', '570000000003', 'poison@example.com', UTC_TIMESTAMP(), 1130000, 1017000, 1243000, 'pending', 0, 0, '', NULL)`,
    );

    try {
      const page = await fetch(site(LEADS_PAGE), { headers: { Cookie: adminCookies } });
      expect(page.status).toBe(200);
      const html = await page.text();
      expect(html).toContain(referenceFor(plainLeadUuid));
      expect(html).not.toContain(referenceFor(poisonUuid));

      const exportHref = scrapeHref(html, 'Export CSV');
      const res = await fetch(new URL(exportHref, site('/')), { headers: { Cookie: adminCookies } });
      expect(res.status).toBe(200);
      const body = stripBom(await res.text());
      expect(body).toContain(referenceFor(plainLeadUuid));
      expect(body).not.toContain('Poison Row');
    } finally {
      await sqlWp(`DELETE FROM ${leadsTable} WHERE request_uuid = '${poisonUuid}'`);
    }
  });

  it('exports every good row across more than one chunk, even with a bad row inside the first chunk', async () => {
    // `CsvExporter::CHUNK` is 500: a bad row in the first batch makes it parse short (499), which must not
    // end the export before the second batch.
    const leadsTable = await table();
    const marker = crypto.randomUUID().replaceAll('-', '').slice(0, 12);
    const goodCount = 510;

    const script = `
<?php
global $wpdb;
$table = $args[0];
$marker = $args[1];
$good_count = (int) $args[2];

// Inserted first, so its lower id lands in the first 500-row batch.
$bad_uuid = sprintf( '00000000-0000-4000-9000-%012d', 0 );
$wpdb->query( $wpdb->prepare(
	"INSERT INTO {$table} (request_uuid, created_at, status, move_type, rooms, origin_city, destination_city, distance_km, move_date, extras, customer_name, phone, email, consent_at, estimate_cop, estimate_low_cop, estimate_high_cop, sync_status, attempts, next_attempt_at, last_error, sent_at) VALUES (%s, UTC_TIMESTAMP(), 'not-a-real-status', 'apartment', 2, 'Barranquilla', 'Cartagena', 120, '2026-11-20', '', %s, '570000000005', %s, UTC_TIMESTAMP(), 1130000, 1017000, 1243000, 'pending', 0, 0, '', NULL)",
	$bad_uuid,
	"Bulk bad row {$marker}",
	"bulk-bad-{$marker}@example.com"
) );

$values = [];
for ( $i = 0; $i < $good_count; $i++ ) {
	$uuid = sprintf( '00000000-0000-4000-8000-%012d', $i );
	$name = $wpdb->_real_escape( "Bulk {$marker} {$i}" );
	$values[] = "('{$uuid}', UTC_TIMESTAMP(), 'new', 'apartment', 2, 'Barranquilla', 'Cartagena', 120, '2026-11-20', '', '{$name}', '570000000004', 'bulk-{$marker}-{$i}@example.com', UTC_TIMESTAMP(), 1130000, 1017000, 1243000, 'pending', 0, 0, '', NULL)";
}
$wpdb->query( "INSERT INTO {$table} (request_uuid, created_at, status, move_type, rooms, origin_city, destination_city, distance_km, move_date, extras, customer_name, phone, email, consent_at, estimate_cop, estimate_low_cop, estimate_high_cop, sync_status, attempts, next_attempt_at, last_error, sent_at) VALUES " . implode( ',', $values ) );
echo 'ok';
`;

    try {
      await wp(['eval-file', '-', leadsTable, marker, String(goodCount)], script);

      const insertedCount = await sqlWp(`SELECT COUNT(*) AS n FROM ${leadsTable} WHERE customer_name LIKE 'Bulk ${marker}%' OR customer_name = 'Bulk bad row ${marker}'`);
      expect(insertedCount[0]?.n).toBe(String(goodCount + 1));

      const page = await fetch(site(LEADS_PAGE), { headers: { Cookie: adminCookies } });
      const html = await page.text();
      const exportHref = scrapeHref(html, 'Export CSV');

      const res = await fetch(new URL(exportHref, site('/')), { headers: { Cookie: adminCookies } });
      expect(res.status).toBe(200);
      const body = stripBom(await res.text());

      expect(body).not.toContain(`Bulk bad row ${marker}`);
      const goodRowCount = body.split(`Bulk ${marker} `).length - 1;
      expect(goodRowCount).toBe(goodCount);
      // The last good row proves the second batch was read.
      expect(body).toContain(`Bulk ${marker} ${String(goodCount - 1)}`);
    } finally {
      await sqlWp(`DELETE FROM ${leadsTable} WHERE customer_name LIKE 'Bulk ${marker}%' OR customer_name = 'Bulk bad row ${marker}'`);
    }
  });

  it('retries a failed delivery: requeued to pending with attempts reset, "queued for delivery" in the notice', async () => {
    await sqlWp(`UPDATE ${await table()} SET sync_status = 'failed', attempts = 3 WHERE request_uuid = '${plainLeadUuid}'`);

    const page = await fetch(site(LEADS_PAGE), { headers: { Cookie: adminCookies } });
    const html = await page.text();
    const retryHref = scrapeHref(html, 'Retry delivery');

    const res = await fetch(new URL(retryHref, site('/')), { headers: { Cookie: adminCookies }, redirect: 'manual' });
    expect(res.status).toBe(302);

    const row = await rowByUuid(plainLeadUuid);
    expect(row.sync_status).toBe('pending');
    expect(row.attempts).toBe('0');

    const redirectLocation = res.headers.get('location');
    expect(redirectLocation).toBeDefined();
    const afterRedirect = await fetch(site(redirectLocation!), { headers: { Cookie: adminCookies } });
    const noticeHtml = await afterRedirect.text();
    expect(noticeHtml).toContain('queued for delivery');
    expect(noticeHtml).not.toMatch(/\bsent\b/i);
  });

  it('shows last_error as visible text in the Delivery column, not only in a title, and escapes it', async () => {
    const leadsTable = await table();
    const errorText = 'HTTP 500: <script>alert(1)</script>';
    await sqlWp(`UPDATE ${leadsTable} SET last_error = '${errorText.replace("'", "''")}' WHERE request_uuid = '${plainLeadUuid}'`);

    try {
      const page = await fetch(site(LEADS_PAGE), { headers: { Cookie: adminCookies } });
      const html = await page.text();
      // Visible as text, not only inside the span's title attribute.
      expect(html).toContain('<small>HTTP 500: &lt;script&gt;alert(1)&lt;/script&gt;</small>');
      expect(html).toContain('title="HTTP 500: &lt;script&gt;alert(1)&lt;/script&gt;"');
      expect(html).not.toContain('<script>alert(1)</script>');
    } finally {
      await sqlWp(`UPDATE ${leadsTable} SET last_error = '' WHERE request_uuid = '${plainLeadUuid}'`);
    }
  });

  it('deletes a lead through the scraped per-row link, and rejects a wrong nonce without deleting it', async () => {
    const leadsTable = await table();
    const toDelete = validLead({ name: 'Delete Me' });
    const deleteRes = await rest(LEADS_PATH, toDelete, { nonce });
    expect(deleteRes.status).toBe(201);
    const deleteUuid = toDelete.submission_id as string;
    const leadId = (await rowByUuid(deleteUuid)).id;

    const page = await fetch(site(LEADS_PAGE), { headers: { Cookie: adminCookies } });
    const html = await page.text();
    const deleteHref = scrapeDeleteHref(html, leadId);

    const wrongNonceUrl = new URL(deleteHref, site('/'));
    wrongNonceUrl.searchParams.set('_wpnonce', 'not-a-real-nonce');
    const wrongNonceRes = await fetch(wrongNonceUrl, { headers: { Cookie: adminCookies }, redirect: 'manual' });
    expect(wrongNonceRes.status).toBe(403);
    const stillThere = await sqlWp(`SELECT id FROM ${leadsTable} WHERE id = ${leadId}`);
    expect(stillThere).toHaveLength(1);

    const res = await fetch(new URL(deleteHref, site('/')), { headers: { Cookie: adminCookies }, redirect: 'manual' });
    expect(res.status).toBe(302);
    const afterDelete = await sqlWp(`SELECT id FROM ${leadsTable} WHERE id = ${leadId}`);
    expect(afterDelete).toHaveLength(0);

    const redirectLocation = res.headers.get('location');
    expect(redirectLocation).toBeDefined();
    const afterRedirect = await fetch(site(redirectLocation!), { headers: { Cookie: adminCookies } });
    expect(await afterRedirect.text()).toContain('The lead was deleted.');
  });

  it('shows the rate-limited-submissions notice once a submit request has been rate-limited, and not before', async () => {
    await resetRateLimits();

    const beforeBurst = await fetch(site(DASHBOARD_PAGE), { headers: { Cookie: adminCookies } });
    expect(await beforeBurst.text()).not.toContain('rate-limited in the current 24-hour window');

    // Five submit requests exhaust the default submit limit; the sixth is rejected and counted.
    for (let i = 0; i < 5; i++) {
      const res = await rest(LEADS_PATH, validLead(), { nonce });
      expect(res.status).toBe(201);
    }
    const limited = await rest(LEADS_PATH, validLead(), { nonce });
    expect(limited.status).toBe(429);

    const dashboard = await fetch(site(DASHBOARD_PAGE), { headers: { Cookie: adminCookies } });
    expect(await dashboard.text()).toContain('1 quote submission was rate-limited in the current 24-hour window.');

    const leadsPage = await fetch(site(LEADS_PAGE), { headers: { Cookie: adminCookies } });
    expect(await leadsPage.text()).toContain('1 quote submission was rate-limited in the current 24-hour window.');

    await resetRateLimits();
  });

  it('shows the stuck-delivery notice for a failed lead and an hour-old pending lead, on the Dashboard and the Leads page, and not otherwise', async () => {
    const leadsTable = await table();

    await sqlWp(`UPDATE ${leadsTable} SET sync_status = 'failed' WHERE request_uuid = '${formulaLeadUuid}'`);
    await sqlWp(`UPDATE ${leadsTable} SET sync_status = 'pending', created_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 61 MINUTE) WHERE request_uuid = '${scriptLeadUuid}'`);

    const leadsPage = await fetch(site(LEADS_PAGE), { headers: { Cookie: adminCookies } });
    expect(await leadsPage.text()).toContain(STUCK_NOTICE_TEXT);

    const dashboard = await fetch(site(DASHBOARD_PAGE), { headers: { Cookie: adminCookies } });
    expect(await dashboard.text()).toContain(STUCK_NOTICE_TEXT);

    // Verify nothing still qualifies first, so a leftover row can't skew the absence assertions.
    await sqlWp(`UPDATE ${leadsTable} SET sync_status = 'sent' WHERE request_uuid IN ('${formulaLeadUuid}', '${scriptLeadUuid}')`);
    const stillStuck = await sqlWp(
      `SELECT id FROM ${leadsTable} WHERE sync_status = 'failed' OR ( sync_status = 'pending' AND created_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 HOUR) )`,
    );
    if (stillStuck.length > 0) throw new Error(`expected no stuck leads before asserting the notice is absent, found ${String(stillStuck.length)}: ${JSON.stringify(stillStuck)}`);

    const clearLeadsPage = await fetch(site(LEADS_PAGE), { headers: { Cookie: adminCookies } });
    expect(await clearLeadsPage.text()).not.toContain(STUCK_NOTICE_TEXT);

    const clearDashboard = await fetch(site(DASHBOARD_PAGE), { headers: { Cookie: adminCookies } });
    expect(await clearDashboard.text()).not.toContain(STUCK_NOTICE_TEXT);
  });

  it('excludes a won or lost lead from the stuck-delivery notice even while it is failed or long-pending', async () => {
    const leadsTable = await table();

    await sqlWp(`UPDATE ${leadsTable} SET sync_status = 'failed', status = 'won' WHERE request_uuid = '${formulaLeadUuid}'`);
    await sqlWp(`UPDATE ${leadsTable} SET sync_status = 'pending', status = 'lost', created_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 61 MINUTE) WHERE request_uuid = '${scriptLeadUuid}'`);

    try {
      const stillQualifying = await sqlWp(
        `SELECT id FROM ${leadsTable} WHERE status NOT IN ('won', 'lost') AND ( sync_status = 'failed' OR ( sync_status = 'pending' AND created_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 HOUR) ) )`,
      );
      if (stillQualifying.length > 0) throw new Error(`expected no stuck leads once won/lost are excluded, found ${String(stillQualifying.length)}: ${JSON.stringify(stillQualifying)}`);

      const leadsPage = await fetch(site(LEADS_PAGE), { headers: { Cookie: adminCookies } });
      expect(await leadsPage.text()).not.toContain(STUCK_NOTICE_TEXT);

      const dashboard = await fetch(site(DASHBOARD_PAGE), { headers: { Cookie: adminCookies } });
      expect(await dashboard.text()).not.toContain(STUCK_NOTICE_TEXT);
    } finally {
      // Restore both rows, so a later test never inherits a closed status.
      await sqlWp(`UPDATE ${leadsTable} SET sync_status = 'sent', status = 'new' WHERE request_uuid IN ('${formulaLeadUuid}', '${scriptLeadUuid}')`);
    }
  });

  it('saves notes through the scraped per-row form, escapes them, and rejects a wrong nonce or a subscriber', async () => {
    const lead = validLead({ name: 'Notes Customer' });
    expect((await rest(LEADS_PATH, lead, { nonce })).status).toBe(201);
    const uuid = lead.submission_id as string;
    const leadId = (await rowByUuid(uuid)).id;
    const leadsTable = await table();
    const html = await (await fetch(site(LEADS_PAGE), { headers: { Cookie: adminCookies } })).text();
    const notesNonce = scrapeNotesNonce(html, leadId);
    expect(html).toContain(`<label class="screen-reader-text" for="moving-quote-notes-${leadId}">Notes for lead ${referenceFor(uuid)}</label>`);
    expect(html).toContain('<textarea id="moving-quote-notes-' + leadId + '" name="notes" maxlength="2000" rows="4">');

    const post = (cookies: string, fields: Record<string, string>) =>
      fetch(site('/wp-admin/admin-post.php'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookies },
        body: new URLSearchParams({ action: 'moving_quote_update_notes', id: leadId, ...fields }),
        redirect: 'manual',
      });
    const storedNotes = async () => (await sqlWp(`SELECT notes FROM ${leadsTable} WHERE request_uuid = '${uuid}'`))[0]?.notes;

    expect((await post(adminCookies, { notes: 'nope', _wpnonce: 'not-a-real-nonce' })).status).toBe(403);
    expect(await storedNotes()).toBe('');

    const saved = await post(adminCookies, { notes: '  Call after 5 <script>alert(1)</script>\nAsk about the piano ', _wpnonce: notesNonce });
    expect(saved.status).toBe(302);
    expect(await storedNotes()).toBe('Call after 5 <script>alert(1)</script>\nAsk about the piano');

    const after = await (await fetch(site(saved.headers.get('location')!), { headers: { Cookie: adminCookies } })).text();
    expect(after).toContain('Notes saved.');
    expect(after).toContain('Call after 5 &lt;script&gt;alert(1)&lt;/script&gt;<br />\nAsk about the piano');
    expect(after).not.toContain('<script>alert(1)</script>');

    // A markup-looking note already stored is escaped when it is printed.
    await sqlWp(`UPDATE ${leadsTable} SET notes = '<b>bold</b> & "quoted"' WHERE request_uuid = '${uuid}'`);
    const escaped = await (await fetch(site(LEADS_PAGE), { headers: { Cookie: adminCookies } })).text();
    expect(escaped).toContain('&lt;b&gt;bold&lt;/b&gt; &amp; &quot;quoted&quot;');
    expect(escaped).not.toContain('<b>bold</b>');

    const password = randomBytes(18).toString('hex');
    await wp(['user', 'create', SUBSCRIBER_LOGIN, `${SUBSCRIBER_LOGIN}@example.com`, '--role=subscriber', `--user_pass=${password}`]);
    try {
      const subscriberCookies = await login(SUBSCRIBER_LOGIN, password);
      expect((await post(subscriberCookies, { notes: 'subscriber', _wpnonce: notesNonce })).status).toBe(403);
      expect(await storedNotes()).toBe('<b>bold</b> & "quoted"');
    } finally {
      await wp(['user', 'delete', SUBSCRIBER_LOGIN, '--yes']);
    }
  });

  it('marks a new lead contacted in one click, and shows the button only on new leads', async () => {
    const lead = validLead({ name: 'Quick Status Customer' });
    expect((await rest(LEADS_PATH, lead, { nonce })).status).toBe(201);
    const uuid = lead.submission_id as string;
    const leadId = (await rowByUuid(uuid)).id;

    const html = await (await fetch(site(LEADS_PAGE), { headers: { Cookie: adminCookies } })).text();
    const form = markContactedForm(html, leadId);
    expect(form).not.toBeNull();
    expect(form).toContain('Mark contacted');
    const quickNonce = /name="_wpnonce" value="([^"]+)"/.exec(form!)![1]!;

    const res = await fetch(site('/wp-admin/admin-post.php'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: adminCookies },
      body: new URLSearchParams({ action: 'moving_quote_update_status', id: leadId, status: 'contacted', _wpnonce: quickNonce }),
      redirect: 'manual',
    });
    expect(res.status).toBe(302);
    expect((await rowByUuid(uuid)).status).toBe('contacted');

    const afterHtml = await (await fetch(site(LEADS_PAGE), { headers: { Cookie: adminCookies } })).text();
    expect(markContactedForm(afterHtml, leadId)).toBeNull();
  });

  it('shows the last-7-days, won and win-rate numbers above the list', async () => {
    const leadsTable = await table();
    const marker = crypto.randomUUID().replaceAll('-', '').slice(0, 12);
    const uuids = [0, 1, 2].map((i) => `00000000-0000-4000-a000-${marker.slice(0, 10)}0${String(i)}`);
    const insert = (uuid: string, status: string, createdAt: string) =>
      sqlWp(
        `INSERT INTO ${leadsTable} (request_uuid, created_at, status, move_type, rooms, origin_city, destination_city, distance_km, move_date, extras, customer_name, phone, email, consent_at, estimate_cop, estimate_low_cop, estimate_high_cop, sync_status, attempts, next_attempt_at, last_error, sent_at)
         VALUES ('${uuid}', ${createdAt}, '${status}', 'apartment', 2, 'Barranquilla', 'Cartagena', 120, '2026-11-20', '', 'Funnel ${marker}', '570000000006', 'funnel-${marker}@example.com', UTC_TIMESTAMP(), 1130000, 1017000, 1243000, 'sent', 0, 0, '', NULL)`,
      );
    await insert(uuids[0]!, 'won', 'UTC_TIMESTAMP()');
    await insert(uuids[1]!, 'won', 'UTC_TIMESTAMP()');
    await insert(uuids[2]!, 'lost', 'DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)');

    try {
      const [recent] = await sqlWp(`SELECT COUNT(*) AS n FROM ${leadsTable} WHERE created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 DAY)`);
      const [won] = await sqlWp(`SELECT COUNT(*) AS n FROM ${leadsTable} WHERE status = 'won'`);
      const [lost] = await sqlWp(`SELECT COUNT(*) AS n FROM ${leadsTable} WHERE status = 'lost'`);
      const rate = Math.round((100 * Number(won?.n)) / (Number(won?.n) + Number(lost?.n)));

      const html = await (await fetch(site(LEADS_PAGE), { headers: { Cookie: adminCookies } })).text();
      const tile = (label: string): string | undefined => {
        const labelAt = html.indexOf(`<span class="moving-quote-leads__stat-label">${label}</span>`);
        const valueAt = html.lastIndexOf('<span class="moving-quote-leads__stat-value">', labelAt);
        return valueAt === -1 || labelAt === -1 ? undefined : html.slice(valueAt, labelAt).replace(/<[^>]+>/g, '').trim();
      };
      expect(tile('Last 7 days')).toBe(String(recent?.n));
      expect(tile('Won (all time)')).toBe(String(won?.n));
      expect(tile('Win rate')).toBe(`${String(rate)}%`);
      // The help line belongs to the Win rate tile, and the tiles sit after the header's Export CSV action.
      const rateTile = html.slice(html.indexOf('moving-quote-leads__stat-label">Win rate'));
      expect(rateTile.indexOf('Won ÷ (won + lost).')).toBeGreaterThan(-1);
      expect(rateTile.indexOf('Won ÷ (won + lost).')).toBeLessThan(rateTile.indexOf('</div>') + 300);
      expect(html.indexOf('>Export CSV<')).toBeLessThan(html.indexOf('moving-quote-leads__stats'));
      expect(html.indexOf('moving-quote-leads__stats')).toBeLessThan(html.indexOf('<table class="wp-list-table'));
    } finally {
      await sqlWp(`DELETE FROM ${leadsTable} WHERE customer_name = 'Funnel ${marker}'`);
    }
  });

  it('shows a "Date confirmed" badge in the Move column once the customer confirmed, and exports the time', async () => {
    const lead = validLead({ name: 'Confirmed Customer' });
    expect((await rest(LEADS_PATH, lead, { nonce })).status).toBe(201);
    const uuid = lead.submission_id as string;
    const leadsTable = await table();

    const before = await (await fetch(site(LEADS_PAGE), { headers: { Cookie: adminCookies } })).text();
    expect(before).not.toContain('moving-quote-leads__confirmed');

    await sqlWp(`UPDATE ${leadsTable} SET date_confirmed_at = '2026-11-05 15:30:00' WHERE request_uuid = '${uuid}'`);
    const after = await (await fetch(site(LEADS_PAGE), { headers: { Cookie: adminCookies } })).text();
    expect(after).toContain('<span class="moving-quote-leads__confirmed">Date confirmed</span>');

    const exportHref = scrapeHref(after, 'Export CSV');
    const body = stripBom(await (await fetch(new URL(exportHref, site('/')), { headers: { Cookie: adminCookies } })).text());
    expect(body).toContain(',"2026-11-05 10:30"');
  });

  it('logs nothing from the plugin', async () => {
    await expect(pluginLogLines()).resolves.toEqual([]);
  });
});
