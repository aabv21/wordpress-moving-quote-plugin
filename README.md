# Chivabox Movers: WordPress Moving-Quote Plugin

**Demo.** Fictional business, not client work.

A custom WordPress plugin that gives instant moving estimates in English and Spanish, keeps every request safe in WordPress, and sends signed leads to n8n for the team sheet and emails.

**Single-site only.** This plugin doesn't support WordPress Multisite; activating it on a Multisite install (network-wide or per-site) is refused with a clear message.

## Architecture

![System architecture: the browser submits to WordPress's REST API, which inserts into the leads table and sends a signed request to n8n's lead-intake workflow; lead-intake records the request once in Postgres and hands off to process-lead, which appends or updates a row in Google Sheets and emails the team and the customer; error-handler alerts the operator on any workflow failure](docs/diagrams/architecture.svg)

Open the [interactive diagram](docs/diagrams/architecture.html) to read it full-size, pan, and inspect each node. The same folder has the [lead-delivery sequence](docs/diagrams/lead-sequence.svg) ([interactive page](docs/diagrams/lead-sequence.html)), the [delivery states](docs/diagrams/delivery-lifecycle.svg), the [personal-data flow](docs/diagrams/personal-data-flow.svg) and the [queue-mode stack](docs/diagrams/queue-mode.svg); each has an interactive `.html` page beside it. [`docs/architecture.md`](docs/architecture.md) covers the components, the workflows node by node, the data model, failure modes with recovery steps, scaling limits, and security. [`docs/testing.md`](docs/testing.md) covers every test suite and what continuous integration (CI) runs. The rest of the reference: [`docs/plugin.md`](docs/plugin.md) (the plugin and the site theme), [`docs/api.md`](docs/api.md) (routes, webhook, shortcodes), [`docs/i18n.md`](docs/i18n.md) (translations and the language switcher), [`docs/database.md`](docs/database.md), and [`docs/supply-chain.md`](docs/supply-chain.md).

## What it does

- **A local moving company's site.** The Chivabox theme (`site/theme/`, a child of Twenty Twenty-Five) gives the demo a full home page: the quote's first step in the hero, a trust strip, how it works, services, popular routes with "from" prices that open the quote prefilled, sample reviews, questions, and a footer with the business's phone, WhatsApp, address, hours and tax ID. Every page has a meta description and Open Graph tags, and the home page carries `MovingCompany` structured data.
- **A three-step quote form with a live estimate.** The `[moving_quote]` shortcode asks for the move (type, rooms, both cities, a date), the extra services, and the customer's details. A summary beside the form (a price bar at the bottom on phones) shows the route, date, extras and the price range in Colombian pesos as the visitor fills them in. A submission lands on a thank-you card with the lead's `MQ-…` reference, that summary, and a WhatsApp link that carries the reference.
- **English and Spanish, with an English | Español switcher.** The demo site is bilingual through Polylang: Get a quote at `/get-a-quote/` and Cotizar at `/es/cotizar/`. The form, its error messages, the price's separators (`COP 1.017.000 – 1.243.000` in Spanish), the thank-you page, and the lead's stored language all follow the page.
- **Every lead is saved first, then delivered.** WordPress stores the lead in its own table, then sends it to n8n as a signed request. If n8n is down, a cron-driven outbox retries with backoff for about 8.5 hours (10 attempts); after that the lead shows Failed in Leads until someone chooses Retry delivery.
- **One sheet row and two emails per lead.** n8n verifies the signature, records the lead once, and writes one row to the `Moving leads` Google Sheet. It then emails the team a plain-text summary and the customer a branded email with their estimate, the move's details and the business's phone and WhatsApp, in the customer's language.
- **A Leads admin page.** Moving quotes → Leads lists every lead with its status and delivery state, filters by status, exports a formula-safe CSV, retries a failed delivery, and warns on the Dashboard when a lead hasn't reached n8n.
- **An alert to the operator.** Any workflow failure emails the operator the failed node, the error, and the execution link, in the team's language.
- **Follow-up that fits the team's day.** The team email carries a `WhatsApp:` chat link for the customer. Each Leads row has a one-click "Mark contacted" and private notes, and three numbers sit above the list: leads in the last 7 days, won, and the win rate. Every Monday at 08:00 n8n emails `digest_email` a plain-text summary of the last seven days.
- **A status page for the customer.** The customer email links a signed page that shows the move's route, date and estimate, and lets the customer confirm the moving date; Leads then shows "Date confirmed".

The site, the quote form, its thank-you card, the Leads admin and the customer status page, on the local stack at 1280 px and 390 px wide:

| Screen | 1280 px | 390 px |
|---|---|---|
| The home page | <img src="docs/screenshots/home-desktop.png" width="480" alt="The Chivabox Movers home page: the logo, Get a quote link, language switcher, phone number and WhatsApp button in the header; a three-line headline about moving on the Caribbean coast with WhatsApp and phone buttons beside a Start your quote card asking what is being moved and both cities; and the top of a wide photo of a mover pushing a stack of boxes"> | <img src="docs/screenshots/home-mobile.png" width="180" alt="The home page at phone width: the header's phone and WhatsApp icon buttons, then the headline, the WhatsApp and phone buttons and the Start your quote card stacked in one column"> |
| Step 1, your move, before anything can be priced | <img src="docs/screenshots/quote-step-1-desktop.png" width="480" alt="Step 1 of the quote form: a numbered three-step progress bar with Your move current, a note that every field but the extras is required, the move fields in two columns, a Next pill button, and a Summary panel beside the form waiting for both cities"> | <img src="docs/screenshots/quote-step-1-mobile.png" width="180" alt="Step 1 of the quote form at phone width: the page title, the progress bar, the required-fields note, and the move fields in one column"> |
| Step 2, extra services, with a live estimate | <img src="docs/screenshots/quote-step-2-desktop.png" width="480" alt="Step 2 of the quote form: step 1 checked off, four extra services as selectable rows each showing its price, Packing selected, and the Summary panel with the route, date, Packing, and an estimated price of COP 1,197,000 to 1,463,000"> | <img src="docs/screenshots/quote-step-2-mobile.png" width="180" alt="Step 2 of the quote form at phone width: the extra services stacked as rows with their prices, and a price bar pinned to the bottom of the screen"> |
| Step 3, your details, with the estimate | <img src="docs/screenshots/quote-step-3-desktop.png" width="480" alt="Step 3 of the quote form: full name, phone with an example under it, email, the consent checkbox linked to the data policy, a Back pill and a near-black Send my request pill, and the Summary panel with a Prefer to talk line and the business phone"> | <img src="docs/screenshots/quote-step-3-mobile.png" width="180" alt="Step 3 of the quote form at phone width: the customer fields in one column with the phone example, the consent checkbox, and the price bar pinned to the bottom of the screen"> |
| A validation error from the server | <img src="docs/screenshots/quote-validation-error-desktop.png" width="480" alt="Step 3 after a rejected submission: the name, phone and email fields outlined in red, each with an icon and a message saying how to fix it, the consent error, and a boxed form message saying Please fix the highlighted fields"> | <img src="docs/screenshots/quote-validation-error-mobile.png" width="180" alt="The same validation errors at phone width, each message under its own field, Back and Send my request side by side, the boxed form message, and the price bar"> |
| The thank-you card | <img src="docs/screenshots/thank-you-desktop.png" width="480" alt="The thank-you page titled Request received: a card with a green check, the lead's reference number, the route, move date and estimate the visitor just sent, and a Write to us on WhatsApp button, beside a numbered What happens next list and a Back to the home page button"> | <img src="docs/screenshots/thank-you-mobile.png" width="180" alt="The thank-you page at phone width: the Request received title, the card with the check, the reference, the route, date and estimate stacked and the WhatsApp button, then the numbered next steps"> |
| Moving quotes → Leads | <img src="docs/screenshots/admin-leads-desktop.png" width="480" alt="The Leads admin screen in WordPress's own styles: an Export CSV button, three tiles (leads in the last 7 days, won, and the win rate with its Won ÷ (won + lost) help line), status views with counts, and a table with a Mark contacted button on new leads, a labelled status select, Update, a red Delete, a Date confirmed mark in the Move column and a Notes column with an Edit notes control"> | <img src="docs/screenshots/admin-leads-mobile.png" width="180" alt="The Leads screen at phone width: the tiles, the status views, and one row expanded into labelled lines showing Mark contacted, the status select and the team's notes"> |
| The customer status page | <img src="docs/screenshots/status-desktop.png" width="480" alt="The Your move page for a valid link: a card saying We received your request, with the reference, route, move date, move type and estimate, and a Confirm my moving date button"> | <img src="docs/screenshots/status-mobile.png" width="180" alt="The same page at phone width, the card stacked in one column"> |
| The status page in Spanish | <img src="docs/screenshots/status-es-desktop.png" width="480" alt="The Su mudanza page in Spanish for a quoted request: Le enviamos una cotización, the summary rows and a Confirmar la fecha de mi mudanza button"> | <img src="docs/screenshots/status-es-mobile.png" width="180" alt="The Spanish status page at phone width"> |
| A link that isn't valid | <img src="docs/screenshots/status-invalid-desktop.png" width="480" alt="The Your move page with one red-outlined sentence: This link isn't valid. Check the link in your email, or contact us."> | <img src="docs/screenshots/status-invalid-mobile.png" width="180" alt="The same sentence at phone width"> |

The site's and the form's colors, with each pair's contrast ratio, are listed under "The design tokens" in [`docs/architecture.md`](docs/architecture.md). The photos and fonts, with their licenses, are credited in [`site/theme/CREDITS.md`](site/theme/CREDITS.md).

## Quick start

**You need**

- Node.js 24 or newer.
- pnpm 11: run `corepack enable`, which reads the exact version from `package.json`.
- Docker with Compose v2.
- Network access for `./setup.sh` (it downloads Polylang and WordPress's Spanish language pack).

```sh
pnpm install --frozen-lockfile
node scripts/init-env.ts && cp config/config.example.json config/config.json
docker compose up -d --wait
./setup.sh
pnpm run setup
```

Once the stack is up:

- WordPress: <http://localhost:8080>, in Spanish at <http://localhost:8080/es/>
- WordPress admin: <http://localhost:8080/wp-admin/>, with `WP_ADMIN_USER` and `WP_ADMIN_PASSWORD` from `.env`
- n8n: <http://localhost:5678>

`./setup.sh` builds the site in both languages, with English as the default. It downloads Polylang and WordPress's Spanish language pack, so it needs network access. `pnpm run setup` imports the n8n credentials and publishes the three workflows; until the Google values are in `.env` (see Configuration), it skips the two Google credentials, and `process-lead` stops at its Google Sheets step.

**One stack at a time.** Every demo in this series binds `127.0.0.1:5678`, and this one also binds `127.0.0.1:8080`. Run `docker compose ls` first, and stop any other demo's stack before bringing this one up.

**Upgrading an existing stack.** A stack from before `db/migrations/` existed follows "The one-time upgrade for an existing local stack" in [`docs/database.md`](docs/database.md). A stack from before the language switcher or the Chivabox theme needs `docker compose up -d --wait` first, so the WordPress containers mount `site/mu-plugins/` and `site/theme/`, then `./setup.sh`, which activates the theme, adds what's missing, and leaves existing pages as they are. To replace the existing pages' content with the theme's current copy, run `SETUP_REFRESH_PAGES=1 ./setup.sh` once; it rewrites only the ten pages `setup.sh` owns. Before the first Monday after an upgrade, add `digest_email` to `config/config.json` (see Configuration), or the weekly summary fails and the operator gets an alert. An existing `Moving leads` sheet needs `request_uuid` added as its 16th header before the next lead, or every lead stops at "Append lead row" and raises the operator alert.

PHP runs only inside Docker; there's no local `php` or `composer`. `pnpm run php <command>` runs a command in the PHP tools container.

### Try it in Playground

No server needed: open the site in [WordPress Playground](https://playground.wordpress.net/?blueprint-url=https://raw.githubusercontent.com/aabv21/wordpress-moving-quote-plugin/main/playground/blueprint.json), or the same site [in Spanish](https://playground.wordpress.net/?blueprint-url=https://raw.githubusercontent.com/aabv21/wordpress-moving-quote-plugin/main/playground/blueprint.es.json). Each installs the plugin and the Chivabox theme from this repository's `main`, creates the pages and the demo business details, and lands on the home page; the quote form gives a working live estimate. Delivery to n8n stays off, and each shows one language, without the switcher.

To run the same thing against the files on disk:

```sh
pnpm dlx @wp-playground/cli@3.1.61 server --php=8.3 --port=9400 --mount=./plugin/moving-quote:/wordpress/wp-content/plugins/moving-quote --mount=./site/theme:/wordpress/wp-content/themes/chivabox --blueprint=playground/blueprint.local.json
```

## Configuration

**A Google OAuth client**, in the Google Cloud console:

- Type "Web application", with the authorized redirect URI `http://localhost:5678/rest/oauth2-credential/callback`.
- The Google Sheets API and the Gmail API enabled.
- The OAuth consent screen published **in Production**. In Testing, Google expires refresh tokens after 7 days, which silences the sheet, both emails, and the operator alert at once.

**`.env`**, written by `node scripts/init-env.ts`, which generates every password and secret. Fill in by hand:

| Key | What it is |
|---|---|
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | The OAuth client above. Run `pnpm run setup` again afterward to import the two Google credentials, then choose "Sign in with Google" on each in n8n. |
| `TEAM_EMAIL` | The team's inbox for new-lead emails. `./setup.sh` copies it into the plugin's settings. |
| `SITE_LOCALE` | The site's default language, `en_US` or `es_CO`. The other language lives under `/es/` or `/en/`. Rerunning `./setup.sh` with the other value switches an existing site, and rewrites the menu links it created so each language keeps pointing at its own pages. |
| `SETUP_REFRESH_PAGES` | `0` by default. `1` makes `./setup.sh` replace the content and excerpt of the pages it owns with their theme pattern; `SETUP_REFRESH_PAGES=1 ./setup.sh` does it once. |

**The `Moving leads` sheet.** A spreadsheet with a tab named `Moving leads`, whose first row is exactly these 16 headers, in this order:

```text
received_at reference name phone email move_date move_type rooms origin destination distance_km extras estimate_cop estimate_low_cop estimate_high_cop request_uuid
```

Format the `phone` column as Plain text. `request_uuid` is how a retried run finds the lead's own row, so it updates that row instead of adding a second one.

**`config/config.json`**, read by n8n:

| Key | What it is |
|---|---|
| `google.leads_sheet_id` | The spreadsheet's ID, from its URL. |
| `google.leads_tab` | The tab name, `Moving leads`. |
| `alerts.error_email` | Where workflow-failure alerts go. |
| `team_locale` | The team email's and the alert's language, `en` or `es`. Anything else falls back to English, with a note in each email. |
| `digest_email` | Where the Monday summary of the last seven days' leads goes. A simple email address; when it is missing or invalid the weekly run fails and the operator is alerted. |

**Business details.** Moving quotes → Settings → Business details holds the phone, WhatsApp number, street address, city, opening hours and tax ID. The site footer, the header's phone and WhatsApp links, the quote page, the thank-you card, the customer email and the home page's structured data all read them, and a blank field hides its line everywhere. `./setup.sh` fills in the fictional demo values (`+57 000 000 0099`, `Calle 00 # 00-00, Barranquilla`, 07:00 to 18:00, `NIT 000.000.000-0`; the footer says in each language that the company and tax ID are fictional) only while every business field is blank, so the owner's own values survive a rerun.

**Rates and cities.** Moving quotes → Settings holds the base rate per move type, the per-room and per-km prices, each extra's price, the range percentage, and the city-to-city distances. Amounts are whole Colombian pesos and accept Colombian formatting: `4.500`, `4,500`, and `4500` all mean 4,500 COP.

**Real system cron.** The stack disables WP-Cron and runs a `cron` container instead. On a real server, add `define( 'DISABLE_WP_CRON', true );` to `wp-config.php`, then run the same command every minute from system cron:

```text
* * * * * wp cron event run --due-now --path=/var/www/html
```

**Behind a reverse proxy.** Rate limits key on `REMOTE_ADDR`, which is the proxy's address. Filter `moving_quote_client_ip` once `REMOTE_ADDR` is a trusted proxy; "Behind a reverse proxy" in [`docs/architecture.md`](docs/architecture.md) has a worked example.

## Test scenarios

Automated suites, each with its own section in [`docs/testing.md`](docs/testing.md):

- `pnpm test`: every TypeScript unit, the n8n Code nodes, the workflow pins, and the tooling.
- `pnpm test tests/dom`: the quote form driven in a DOM (happy-dom), against a fixture of the real markup.
- `pnpm run php composer check`: PHPCS, PHPStan level 9, and PHPUnit for every pure PHP class.
- `pnpm run test:stack:wp`: WordPress on the real stack, covering install, settings, the REST API, the form, the Leads admin, delivery, and both languages.
- `pnpm run test:stack:n8n`: the three workflows on the real stack, from a signed lead to the operator alert.
- The queue-mode run: follow ["The queue-mode run"](docs/testing.md#the-queue-mode-run), then run `pnpm exec vitest run --config vitest.stack.config.ts tests/stack/n8n/intake.test.ts`.

By hand, on the local stack. A stack test already covers each scenario's WordPress half; these confirm the whole path with a real Google account:

| Scenario | Expected result |
|---|---|
| 1. Apartment, 2 rooms, Barranquilla → Cartagena, no extras, at `/get-a-quote/` | The form shows `COP 1,017,000 – 1,243,000`. One sheet row with the headers in order, `phone` as the text `570000000001`, and a formula-looking name as literal text. A plain-text team email with the subject `New lead MQ-…: Barranquilla to Cartagena on …`. A customer email that replies to the team address, with no n8n attribution. Leads shows it as Sent. |
| 2. House, 4 rooms, Cartagena → Santa Marta, every extra | `COP 2,592,000 – 3,168,000` in the form, in the row's `estimate_low_cop`/`estimate_high_cop`, and in both emails. |
| 3. `docker compose stop n8n`, submit scenario 1, then `docker compose start n8n` | The thank-you page appears at once. The lead is Pending with an error, then Sent within about 2 minutes. Exactly one row and one email pair. Covered for WordPress by `end-to-end.test.ts`'s n8n-stopped case. |
| 4. Moving quotes → Settings, set the webhook secret to any other 32+ characters, then submit | Delivery shows `HTTP 403` and nothing reaches the sheet. `./setup.sh` restores the secret from `.env`; "Retry delivery" then sends it, once. Covered for WordPress by `end-to-end.test.ts`'s wrong-secret case. |
| 5. In dev tools, `document.querySelector('[name=website]').value = 'x'`, then submit | The thank-you page shows, but there's no lead and no row. Covered by `quote-api.test.ts`'s honeypot case. |
| 6. Moving quotes → Settings, per km `5.000` | Scenario 1 shows `COP 1,125,000 – 1,375,000`. Restore `4.000`. |

### Live checks (need a Google account)

Set up, in order:

1. The OAuth client, as in Configuration: the redirect URI, both APIs enabled, and the consent screen in Production.
2. `.env`: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, and `TEAM_EMAIL`.
3. The spreadsheet with its `Moving leads` tab and the 16 headers above (`phone` as Plain text), and `config/config.json`'s `google.leads_sheet_id`, `google.leads_tab`, `alerts.error_email`, and `team_locale`.
4. `docker compose up -d --wait`, `./setup.sh`, then `pnpm run setup`. Add `pnpm run setup -- --refresh cvbCredGmail0001` only if the Gmail credential was imported before it was narrowed to send-only.
5. In n8n, "Sign in with Google" on both Google credentials. Gmail's consent screen must ask only to send email.
6. The sender's display name: Gmail → Settings → Accounts → "Send mail as" → edit the name.

Then:

| Check | Expected result |
|---|---|
| Scenarios 1–6 above | As listed. |
| Switch to ES in the header, then send scenario 1 from `/es/cotizar/` | Lands on `/es/gracias/?reference=MQ-…`. The lead's CSV row has `es_CO`. The customer email is `Su cotización de mudanza de …` with `COP 1.017.000 – 1.243.000`. With `team_locale: "en"` the team email is English; with `"es"`, the next one is `Nueva solicitud MQ-…`. |
| Set `team_locale` to `"ES"`, submit, then restore it | The team email is English and ends with `Note: config.team_locale is not "en" or "es"…`. The customer email is still in the lead's language. |
| Rename the `Moving leads` tab, then submit scenario 1 | After 3 tries, one `[Chivabox demo] Workflow failed: Process lead` email reaches `alerts.error_email`, naming "Append lead row". Then follow "Retrying a failed execution" below: still one row for that lead, updated in place by its `request_uuid`, and both emails again. |
| The same with `team_locale: "es"`, then restore it | The subject is `[Chivabox demo] Falló el flujo: Process lead`, with Spanish labels. |
| With both Google credentials signed in, `pnpm run test:stack:n8n` | Every case that would reach `process-lead` or `error-handler` prints its skip message. No test row and no email. |
| The Gmail consent and the sender name | The consent is send-only, and the sender name shows on both emails. |
| Send scenario 1, then open the customer email in Gmail | A header with "Chivabox Movers", the estimate as a large figure, rows for route, date, type, extras and reference, and a line "Questions? Call us at +57 000 000 0099 or write on WhatsApp" whose link opens `https://wa.me/570000000099`. |
| Send scenario 1 with phone `3000000000` (the visitor's), then open the team email | A line `WhatsApp: https://wa.me/573000000000`; tapping it on a phone opens a chat. |
| `docker compose exec -T n8n n8n execute --id cvbWeeklyDigest1` | One email to `config.json`'s `digest_email` with the subject `[Chivabox Movers] Weekly summary: N leads, YYYY-MM-DD to YYYY-MM-DD` and the counts of the last 7 days' rows. |
| Open "See your request and confirm your date" in the customer email, then choose "Confirm my moving date" | The status page shows the reference, route, date and estimate, then "You confirmed your moving date on …"; Leads shows "Date confirmed" on that row. |
| Both Playground links above, once this version is on `main` | `blueprint.json` shows the redesigned English home with the Chivabox theme; `blueprint.es.json` the Spanish one. |

### Retrying a failed execution

Run this after the tab-rename check above. Each retry resends the team and customer emails.

1. Rename the tab back to `Moving leads`.
2. In n8n's executions list, choose Retry on the failed `process-lead` execution. It resumes at "Append lead row", adds the row, and sends both emails.
3. n8n now hides Retry on that execution, so retry it once more through its API. Create a key in n8n under Settings → n8n API.
4. Run `read -rs N8N_API_KEY && export N8N_API_KEY` and paste the key.
5. Take the failed execution's ID from its URL, then run `curl -fsS -X POST -H "X-N8N-API-KEY: $N8N_API_KEY" -H 'Content-Type: application/json' -d '{}' http://localhost:5678/api/v1/executions/<execution id>/retry`. It answers with `"mode":"retry"`.
6. Check the sheet: still one row for that lead, and both emails again.

## Design decisions

Each is explained in full under "Decisions" in [`docs/architecture.md`](docs/architecture.md).

- **JWT over a hand-rolled HMAC header.** n8n's Webhook node verifies HS256 natively, so the secret stays in an n8n credential and a bad token never starts an execution.
- **The leads table is the outbox.** WordPress saves the lead first and sends it second, so an n8n outage delays a lead instead of losing it: it waits in the table until it's sent or retried by hand.
- **`jti` dedupe in Postgres.** One UUID is the lead's key, the token's `jti`, and the `processed_events` key, so a retried delivery is recorded once.
- **Append or update by `request_uuid`, in `RAW` cells.** A retried run updates the lead's own row instead of adding a second, and phones and formula-looking names stay text.
- **Append before email.** No email goes out for a lead that isn't in the sheet.
- **A plain-text team email.** It's built from visitor input, so it carries no `tel:` or `mailto:` links a crafted address could abuse. One line, `https://wa.me/<digits>`, is built only from the validated digits (a 10-digit mobile starting with 3 gets `57` in front).
- **The status link is signed, not secret-free.** It carries the lead's UUID and an HMAC-SHA256 of it (key derived from WordPress's `auth` salt, compared with `hash_equals`), never a name, phone or email. A wrong token, another lead's UUID and a deleted lead all get the same "This link isn't valid" sentence, so the page can't be used to probe which leads exist. The date confirmation needs no nonce, since the customer has no session: the token is the authorization.
- **Polylang as a soft dependency.** The plugin follows whatever language a page is in and works without Polylang.
- **The site is a child theme.** The page copy lives in `site/theme/patterns/`, translated through gettext like the plugin, so `setup.sh` and the blueprints write only a pattern reference per page. The plugin owns what only it knows (the business details, the route prices, the form, the structured data); the theme owns the look and the meta tags.
- **Alerts in the team's language.** The team email and the operator alert both follow `team_locale`, and an invalid value never blocks either.
- **Scaling.** `compose.queue.yaml` switches n8n to queue mode, with Redis and workers; see "Scaling" in [`docs/architecture.md`](docs/architecture.md).

## Limitations

- **Rate limits are per IP and fixed-window.** Visitors behind one shared NAT share one budget (5 submissions an hour by default). Upgrade: a per-visitor token, or a CAPTCHA.
- **A page cache can serve a stale nonce**, and the form then answers "Your session expired". Upgrade: exclude the quote page from the cache.
- **Delivery gives up after 10 attempts.** About 8.5 hours of backoff; the lead then shows Failed in Leads and on the Dashboard until someone chooses Retry delivery. Upgrade: an operator alert when a lead turns Failed.
- **Distances are approximate**, from a fixed city-to-city table in Settings. Upgrade: a routing API.
- **WordPress and n8n need synced clocks (NTP)** when they run on different hosts: a token lives 300 seconds, with 60 seconds of allowed skew.
- **The webhook secret is stored in the database.** Upgrade: a `wp-config.php` constant.
- **Single site only.** Multisite activation is refused.
- **The status link never expires.** Anyone holding the emailed link sees the move summary (route, date, estimate and status, never the name, phone or email) until the lead is deleted, and rotating the WordPress `auth` salt invalidates every link already sent. Upgrade: sign an expiry inside the message and have the check reject a past one.
- **Playground runs without delivery and in one language**, since it has no n8n and no Polylang.
- **An email can still double on a retry.** A retry after Gmail sent but before n8n saw the answer resends it; the sheet row can't double. Duplicates are found by the `MQ-…` reference in the subject.
- **Append before email, and one shared OAuth client.** A failed append sends no email, and an expired Google grant silences the sheet, both emails, and the alert at once.
- **A false duplicate.** A lost acknowledgement from Postgres can make a new lead read as a replay, so it never reaches the sheet. "Recovering a false duplicate" in [`docs/architecture.md`](docs/architecture.md) has the commands.
- **The sheet lookup grows with its rows.** Each run reads the `request_uuid` column to find a match, which is fine for tens of thousands of leads. Upgrade: a keyed store checked before writing.
- **Sample business data.** The phone, address, tax ID and reviews are invented and marked as such.
- **`./setup.sh` needs network access** to download Polylang and WordPress's Spanish language pack.
- **A site first set up in Spanish before the language switcher keeps Spanish copy on its English pages.** Those pages (English slugs, Spanish text) get tagged English. To fix one, delete the `home`, `get-a-quote`, and `thank-you` pages and the `primary-navigation` menu (`docker compose exec -T wpcli wp post delete <id> --force`), then rerun `./setup.sh`, which recreates them in English.

## License

[MIT](LICENSE).
