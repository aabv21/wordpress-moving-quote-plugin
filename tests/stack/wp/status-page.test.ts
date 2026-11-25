import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteCreatedLeads, validLead } from '../lib/leads.ts';
import { disableDelivery, resetRateLimits, rest, restNonce, site, sqlWp, table, wp } from '../lib/stack.ts';

const LEADS_PATH = '/moving-quote/v1/leads';
const INVALID_TEXT = 'This link isn&#039;t valid. Check the link in your email, or contact us.';

/** The status link `StatusShortcode::url_for()` gives a stored lead, as the delivery would email it. */
async function linkFor(requestUuid: string): Promise<URL> {
  const script = `<?php
$lead = ( new \\Chivabox\\MovingQuote\\Leads\\LeadRepository() )->find_by_uuid( $args[0] );
echo \\Chivabox\\MovingQuote\\Frontend\\StatusShortcode::url_for( $lead );
`;
  return new URL((await wp(['eval-file', '-', requestUuid], script)).trim());
}

async function createLead(overrides: Record<string, unknown>, nonce: string, locale?: string): Promise<string> {
  const lead = validLead(overrides);
  await resetRateLimits();
  const res = await rest(locale === undefined ? LEADS_PATH : `${LEADS_PATH}?locale=${locale}`, lead, { nonce });
  expect(res.status).toBe(201);
  return lead.submission_id as string;
}

async function confirmedAt(requestUuid: string): Promise<string | null> {
  const rows = await sqlWp(`SELECT date_confirmed_at FROM ${await table()} WHERE request_uuid = '${requestUuid}'`);
  return rows[0]?.date_confirmed_at ?? null;
}

function postConfirm(fields: Record<string, string>): Promise<Response> {
  return fetch(site('/wp-admin/admin-post.php'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ action: 'moving_quote_confirm_date', ...fields }),
    redirect: 'manual',
  });
}

/** The page body after the redirect a confirm answers with. */
async function followRedirect(res: Response): Promise<string> {
  expect(res.status).toBe(302);
  return (await fetch(new URL(res.headers.get('location') ?? '', site('/')))).text();
}

function invalidParagraph(html: string): string | undefined {
  return /<p class="moving-quote-status__invalid">[\s\S]*?<\/p>/.exec(html)?.[0];
}

describe('the customer status page', () => {
  let restoreDelivery: () => Promise<void>;
  let nonce: string;

  beforeAll(async () => {
    restoreDelivery = await disableDelivery();
    await resetRateLimits();
    nonce = await restNonce();
  });
  afterAll(async () => {
    await restoreDelivery();
    await deleteCreatedLeads();
  });

  it('shows the move summary for a valid link, and never the name, phone or email', async () => {
    const uuid = await createLead({ name: 'Valentina Ríos Statuspage', email: 'status-summary@example.com', phone: '570000000071' }, nonce);
    const link = await linkFor(uuid);
    expect(link.pathname).toBe('/my-move/');
    expect([...link.searchParams.keys()]).toEqual(['lead', 'token']);
    expect(link.search).not.toMatch(/Valentina|status-summary|570000000071|example/);

    const res = await fetch(link);
    expect(res.status).toBe(200);
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('x-robots-tag')).toContain('noindex');
    expect(res.headers.get('cache-control')).toContain('no-store');
    const html = await res.text();
    expect(html).toContain(`MQ-${uuid.replaceAll('-', '').slice(0, 8).toUpperCase()}`);
    expect(html).toContain('Barranquilla → Cartagena');
    expect(html).toContain('We received your request');
    const englishDate = new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Bogota' }).format(new Date(Date.now() + 30 * 86_400_000));
    expect(html).toContain(englishDate);
    expect(html).toContain('COP ');
    expect(html).toContain('Confirm my moving date');
    expect(html).not.toContain(INVALID_TEXT);
    for (const secret of ['Valentina', 'Statuspage', 'status-summary@example.com', '570000000071']) expect(html).not.toContain(secret);
  });

  it("answers a tampered token, another lead's UUID and an erased lead with the same invalid-link text, and changes nothing on confirm", async () => {
    const first = await createLead({ email: 'status-first@example.com' }, nonce);
    const second = await createLead({ email: 'status-second@example.com' }, nonce);
    const erased = await createLead({ email: 'status-erased@example.com' }, nonce);
    const firstLink = await linkFor(first);
    const erasedLink = await linkFor(erased);
    await sqlWp(`DELETE FROM ${await table()} WHERE request_uuid = '${erased}'`);

    const token = firstLink.searchParams.get('token') ?? '';
    const tampered = new URL(firstLink);
    tampered.searchParams.set('token', `${token.slice(0, 63)}${token.endsWith('a') ? 'b' : 'a'}`);
    const otherLead = new URL(firstLink);
    otherLead.searchParams.set('lead', second);
    const attempts = [
      { name: 'tampered token', url: tampered },
      { name: "another lead's UUID with a copied token", url: otherLead },
      { name: 'an erased lead', url: erasedLink },
    ];

    const paragraphs: (string | undefined)[] = [];
    for (const attempt of attempts) {
      const html = await (await fetch(attempt.url)).text();
      const paragraph = invalidParagraph(html);
      paragraphs.push(paragraph);
      expect(html, attempt.name).not.toContain('moving-quote-status__summary');
      expect(html, attempt.name).not.toContain('We received your request');
      expect(html, attempt.name).not.toContain('Confirm my moving date');

      const post = await postConfirm({ lead: attempt.url.searchParams.get('lead') ?? '', token: attempt.url.searchParams.get('token') ?? '' });
      expect(post.headers.get('location') ?? '', attempt.name).not.toContain('confirmed=1');
      expect(invalidParagraph(await followRedirect(post)), attempt.name).toBe(paragraph);
    }

    expect(paragraphs[0]).toContain(INVALID_TEXT);
    expect(new Set(paragraphs).size).toBe(1);
    expect(await confirmedAt(first)).toBeNull();
    expect(await confirmedAt(second)).toBeNull();
  });

  it('confirms the date once: a second confirm keeps the first time', async () => {
    const uuid = await createLead({}, nonce);
    const link = await linkFor(uuid);
    const fields = { lead: uuid, token: link.searchParams.get('token') ?? '' };

    const first = await postConfirm(fields);
    const html = await followRedirect(first);
    expect(first.headers.get('location')).toContain('confirmed=1');
    expect(html).toMatch(/You confirmed your moving date on [^<]+\./);
    expect(html).not.toContain('Confirm my moving date');
    expect(await confirmedAt(uuid)).not.toBeNull();

    await sqlWp(`UPDATE ${await table()} SET date_confirmed_at = '2020-01-01 00:00:00' WHERE request_uuid = '${uuid}'`);
    await followRedirect(await postConfirm(fields));
    expect(await confirmedAt(uuid)).toBe('2020-01-01 00:00:00');
  });

  it('hides the confirm button for a lost lead or a past move date, and a forced confirm changes nothing for a lost lead', async () => {
    const lost = await createLead({}, nonce);
    const past = await createLead({}, nonce);
    const leadsTable = await table();
    await sqlWp(`UPDATE ${leadsTable} SET status = 'lost' WHERE request_uuid = '${lost}'`);
    await sqlWp(`UPDATE ${leadsTable} SET move_date = DATE_SUB(CURDATE(), INTERVAL 3 DAY) WHERE request_uuid = '${past}'`);

    const lostLink = await linkFor(lost);
    const lostHtml = await (await fetch(lostLink)).text();
    expect(lostHtml).toContain('This request is closed');
    expect(lostHtml).not.toContain('Confirm my moving date');
    const pastHtml = await (await fetch(await linkFor(past))).text();
    expect(pastHtml).toContain('moving-quote-status__summary');
    expect(pastHtml).not.toContain('Confirm my moving date');

    await postConfirm({ lead: lost, token: lostLink.searchParams.get('token') ?? '' });
    expect(await confirmedAt(lost)).toBeNull();
    await postConfirm({ lead: past, token: (await linkFor(past)).searchParams.get('token') ?? '' });
    expect(await confirmedAt(past)).toBeNull();
  });

  it("the Spanish lead's link opens the Spanish page", async () => {
    const uuid = await createLead({ name: 'Cliente Prueba' }, nonce, 'es_CO');
    const link = await linkFor(uuid);
    expect(link.pathname).toBe('/es/mi-mudanza/');

    const html = await (await fetch(link)).text();
    expect(html).toContain('Recibimos su solicitud');
    expect(html).toContain('Confirmar la fecha de mi mudanza');
    // The move date reads as Spanish writes it, whatever the site's date_format option says.
    const moveDate = new Date(Date.now() + 30 * 86_400_000);
    const spanishDate = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Bogota' }).format(moveDate);
    expect(html).toContain(spanishDate);
    expect(html).toContain('Barranquilla → Cartagena');
  });

  it('keeps the visitor in their language when a confirm is rejected, and never shows the intro line above an invalid link', async () => {
    const uuid = await createLead({}, nonce, 'es_CO');
    const damaged = await postConfirm({ lead: uuid, token: 'f'.repeat(64), lang: 'es' });
    expect(new URL(damaged.headers.get('location') ?? '', site('/')).pathname).toBe('/es/mi-mudanza/');

    const unknown = await postConfirm({ lead: crypto.randomUUID(), token: 'f'.repeat(64), lang: 'es' });
    expect(new URL(unknown.headers.get('location') ?? '', site('/')).pathname).toBe('/es/mi-mudanza/');
    const unsupported = await postConfirm({ lead: crypto.randomUUID(), token: 'f'.repeat(64), lang: '../evil' });
    expect(new URL(unsupported.headers.get('location') ?? '', site('/')).pathname).toBe('/my-move/');

    const bare = await (await fetch(site('/my-move/'))).text();
    expect(bare).not.toContain('Here is where your moving request stands.');
    expect(await (await fetch(site('/es/mi-mudanza/'))).text()).not.toContain('Aquí puede ver cómo va su solicitud');
  });

  it('keeps the bare status pages out of search: noindex, and not in the sitemap', async () => {
    for (const path of ['/my-move/', '/es/mi-mudanza/']) {
      const res = await fetch(site(path));
      expect(res.headers.get('x-robots-tag'), path).toContain('noindex');
      expect(await res.text(), path).toMatch(/<meta name=['"]robots['"] content=['"][^'"]*noindex/);
    }
    const sitemap = await (await fetch(site('/wp-sitemap-posts-page-1.xml'))).text();
    expect(sitemap).toContain('/get-a-quote/');
    expect(sitemap).not.toMatch(/my-move|mi-mudanza/);
  });

  it('prints the invalid-link text when the page is opened without a link', async () => {
    const html = await (await fetch(site('/my-move/'))).text();
    expect(invalidParagraph(html)).toContain(INVALID_TEXT);
    const spanish = await (await fetch(site('/es/mi-mudanza/'))).text();
    expect(spanish).toContain('Este enlace no es válido. Revise el enlace de su correo o contáctenos.');
  });
});
