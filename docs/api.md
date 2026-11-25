# API reference

Every surface the plugin exposes or calls, one table per surface. The tables list what a caller needs; the behavior behind each route, the rate limiter and the filters follow in "REST behavior". Delivery internals are in [`plugin.md`](plugin.md).

## REST routes

Namespace `moving-quote/v1`. Both routes take `?locale=<the page's determine_locale()>`.

| Method | Path | Caller | Auth | Request fields | Success | Errors |
|---|---|---|---|---|---|---|
| POST | `/wp-json/moving-quote/v1/estimate` | The quote form, on every change | None (no nonce; the frontend never sends one) | `move_type`, `rooms`, `origin`, `destination`, `extras` | 200 with the estimate (`amount`, `low`, `high`, `distance_km`, `currency`, `display`) | 422 `moving_quote_invalid` with `data.errors` (field to message); 429 `moving_quote_rate_limited` with `Retry-After` (120 per 600 s) |
| POST | `/wp-json/moving-quote/v1/leads` | The quote form's submit | `X-WP-Nonce` (action `wp_rest`); honeypot field `website` must be empty | `submission_id` (UUID v4), `move_date`, `name`, `phone`, `email`, `consent`, plus every estimate field above | 201 `{ok, reference, estimate}` for a new lead; 200 with the same shape for a duplicate `submission_id`; 201 `{ok: true}` for a filled honeypot (nothing saved) | 403 `moving_quote_bad_nonce` (header missing) or `rest_cookie_invalid_nonce` (stale or forged); 422 `moving_quote_invalid`; 429 `moving_quote_rate_limited` (5 per 3,600 s, counted only on insert); 500 `moving_quote_save_failed` |

Field rules come from `LeadValidator::quote()` (the estimate fields) and `LeadValidator::lead()` (the rest); the field messages are in "The quote form" in [`plugin.md`](plugin.md).

## The n8n webhook

`POST /webhook/moving-quote/leads` (workflow `lead-intake`), called by `Delivery\WebhookClient::send()`.

| Item | Value |
|---|---|
| Auth | `Authorization: Bearer <JWT>` (JSON Web Token), HS256 with the shared webhook secret; the algorithm is pinned by the `jwtAuth` credential |
| Claims | `iat`, `exp` (`iat + 300`), `jti` (JWT ID, equal to `request_uuid`), `body_sha256` (the SHA-256 of the exact body bytes) |
| Body | The lead payload: `request_uuid`, `reference`, `submitted_at`, `site_name`, `team_email`, `locale`, `contact` (`phone`, `whatsapp`; optional for a lead queued by an older plugin), `customer`, `move`, `estimate`. `src/nodes/lead.ts` (`parseLead()`) is the contract, and `tests/fixtures/lead-payload.json` its fixed example. |
| 200 | `{"status": "accepted"}` or `{"status": "duplicate"}` |
| 401 | `missing_claims`, `token_lifetime`, `token_not_yet_valid`, `token_expired`, `body_hash_mismatch`, `jti_mismatch` |
| 403 | A missing token or a bad signature, rejected by the Webhook node's own `jwtAuth` check before any execution starts (plain text) |
| 422 | `invalid_payload` |

The payload contract changes in four places together: `LeadPayload::body()`, `parseLead()`, `tests/fixtures/lead-payload.json` and both parity tests.

## Admin actions (`admin-post.php`)

Each handler checks `manage_options` first (403; a missing or non-numeric `id` is 400), then its nonce, then acts and redirects with a notice. No `admin_post_nopriv_` action is registered.

| Action | Caller | Auth | Request fields | Success | Errors |
|---|---|---|---|---|---|
| `moving_quote_update_status` | The status form on each Leads row (POST) | `manage_options` + nonce `moving_quote_update_status_{id}` | `id`, `status` (the "Mark contacted" button on a `new` row posts the same action with `status=contacted`) | Redirect with a notice; an unknown status is a no-op | 400, 403 |
| `moving_quote_update_notes` | The notes form inside a Leads row's "Edit notes" (POST) | `manage_options` + nonce `moving_quote_update_notes_{id}` | `id`, `notes` (trimmed, control characters other than line feeds removed, cut to 2,000 characters) | Redirect with a notice | 400, 403 |
| `moving_quote_confirm_date` | "Confirm my moving date" on the customer status page (POST, public: `admin_post_nopriv_` too) | The signed token in the request (HMAC of the lead UUID, `hash_equals`); no nonce, since the visitor has no session | `lead`, `token` | Stamps `date_confirmed_at` once, then redirects to the status page with `confirmed=1` | A bad token, another lead's UUID or an erased lead redirect to the page without `confirmed` and change nothing |
| `moving_quote_retry_delivery` | "Retry delivery" on a `failed` row (GET link) | `manage_options` + nonce `moving_quote_retry_delivery_{id}` | `id` | Redirect: queued for delivery, never "sent" | 400, 403 |
| `moving_quote_delete_lead` | "Delete" on a row, after a `confirm()` (GET link) | `manage_options` + nonce `moving_quote_delete_lead_{id}` | `id` | Redirect with a notice | 400, 403 |
| `moving_quote_export_csv` | "Export CSV" on the Leads page (GET link) | `manage_options` + nonce `moving_quote_export_csv` | none | `text/csv; charset=utf-8`, `moving-leads-{Y-m-d}.csv`, UTF-8 BOM, 500-row batches | 403 |

## Personal-data tools

`Admin\PersonalData` registers the exporter and the eraser `moving-quote-leads` through core's `wp_privacy_personal_data_exporters` and `_erasers` filters. They are reached only through Tools, Export or Erase Personal Data, which owns the capability check and the request; neither has its own route or nonce. Both match leads by email. The eraser reports `items_retained` with every `MQ-` reference to remove by hand.

## Cron

Hook `moving_quote_process_outbox` on the `moving_quote_every_minute` schedule (60 s), run by the `cron` sidecar with `wp cron event run --due-now`. `Delivery\Outbox::process_due()` handles up to 20 due rows per run.

## Shortcodes

| Shortcode | Attributes | Renders |
|---|---|---|
| `[moving_quote]` | `thank_you` (page slug, default `thank-you`) | The three-step form |
| `[moving_quote_start]` | `quote` (page slug, default `get-a-quote`) | The hero's step-1 GET form |
| `[moving_quote_routes]` | `quote`, `routes` (`A:B,C:D`) | Route chips with "from" prices |
| `[moving_quote_contact]` | `layout` (`footer`, `whatsapp`, `phone`) | The business details |
| `[moving_quote_thanks]` | `heading` (`1` or `0`) | The thank-you card |
| `[moving_quote_status]` | none | The customer status page: the move summary and a "Confirm my moving date" button for a valid signed link (`lead` and `token` in the query); one "This link isn't valid" sentence for anything else |
| `[moving_quote_reference]` | none | "Your reference number is MQ-…" (kept for older pages) |

## REST behavior

The codes and limits are in the table above; this is how the routes behave.

- **The page's language.** The form's REST URLs carry `?locale=<the page's determine_locale()>`. `Rest\RequestLocale::of()` accepts it only when it's exactly an installed locale (`en_US` or one of `get_available_languages()`, through the pure `Rest\LocaleParam::pick()`), else falls back to `determine_locale()`, and `RequestLocale::run()` runs the whole route under `switch_to_locale()`. So field messages, the price's separators, and the lead's stored `locale` follow the page. A multilingual plugin sets the language per page, from its URL; a REST request has no language in its URL, so without this it would run in the site language.
- **The estimate route** (`Rest\EstimateController`) prices with `LeadValidator::quote()` and `Pricing\Calculator` against the current settings.
- **The lead route** (`Rest\LeadController`). In order: nonce, honeypot (`website`), validation (`LeadValidator::lead()`), pricing, a duplicate lookup by `submission_id` (= `request_uuid`), the `submit` rate limit, then the insert.
  - **The `submit` limit (5 per 3,600 s) counts only a lead about to be inserted**, so a corrected typo or a double tap never spends it.
  - **Neither route has an `args` schema.** Core would answer its own 400 `rest_invalid_param` before the 422 contract; `LeadValidator` validates every field instead.
  - **Two nonce errors.** A missing header gets the plugin's 403 `moving_quote_bad_nonce`. A stale or forged nonce is rejected first by core's `rest_cookie_check_errors` with 403 `rest_cookie_invalid_nonce`. The estimate route must never receive a nonce from the frontend.
- **`Security\RateLimiter`** keeps fixed-window counts in transients keyed `moving_quote_rl_{bucket}_{hash}`, hashed from the client IP so no IP is stored. A MySQL named lock (`GET_LOCK`/`RELEASE_LOCK`) guards the read-check-write. `acquire_lock()` counts only MySQL's `'1'` and Playground's SQLite answer `'1=1'` as granted, so `'0'`, `NULL`, or anything else fails closed.
  - **`moving_quote_client_ip`.** `client_ip()` reads `REMOTE_ADDR`, which behind a reverse proxy is the proxy's address. Filter it only once `REMOTE_ADDR` is a trusted proxy, and never trust `X-Forwarded-For` or `CF-Connecting-IP` unconditionally; see "Behind a reverse proxy" in [`architecture.md`](architecture.md) for the example.
  - **`moving_quote_rate_limits`.** `Security\RateLimits::estimate()`/`::submit()` read both buckets through this filter, which receives and returns the full `['estimate' => [...], 'submit' => [...]]` shape; a missing or malformed entry falls back to the defaults (120/600 s, 5/3,600 s) for that bucket. Neither controller hardcodes a limit.
  - **Rate-limited submissions are counted.** Each `/leads` 429 calls `RateLimiter::record_rate_limited_submission()`, which increments one transient (`RATE_LIMITED_COUNT_TRANSIENT`) with no IP or per-visitor data. Its 24-hour window is fixed from the first counted 429, not rolling. `StuckDeliveryNotice` shows it.

## Status link and weekly digest

The lead payload gains a top-level `status_url` after `contact`: `''` when the site has no status page, else the signed `my-move` link. `parseLead()` reads it as optional (missing is `''`) and accepts only `''` or an `http(s)` URL with no whitespace, quote or angle bracket. The customer email links it as "See your request and confirm your date". The `weekly-digest` workflow has no webhook; its schedule and `digest_email` are in `docs/architecture.md`.
