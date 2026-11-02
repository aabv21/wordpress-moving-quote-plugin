# How the database is run

Two databases back this repo: MySQL, which WordPress itself owns (the leads table, plugin options), and Postgres (`app`, n8n's idempotency ledger, `processed_events`; `n8n`, n8n's own workflows, credentials, and executions). This page covers which role reaches what on the Postgres side, every statement the workflows issue and the grant behind it, how schema changes ship, how long data stays on both databases, backup and restore for both, connections, and how `node scripts/check-db.ts` proves the Postgres protections hold. The [architecture doc](architecture.md) covers the data model's place in the lead lifecycle.

## Roles (Postgres)

| Role | Owns | Used by | Can |
|---|---|---|---|
| `postgres` (`POSTGRES_USER`) | the server | `db/init/` and `db-migrate`, over the `postgres` container's local socket | Everything. It's never configured in the n8n container. |
| `n8n` (`N8N_DB_USER`) | database `n8n` | n8n itself | Its own database only. |
| `app` (`APP_DB_USER`) | database `app` and its tables | `db-migrate`'s `SET LOCAL ROLE` while creating a table; stack tests, as test tooling (see below) | Everything in `app`. Never used by n8n directly. |
| `app_runtime` (`APP_RUNTIME_DB_USER`) | nothing | the `App DB` credential, which `lead-intake`'s one Postgres node uses | The DML listed below, and nothing else. |

`db/migrations/001_runtime_role.sql` creates `app_runtime` and grants it exactly what the one statement below needs.

### Stack tests read as the owner role, on purpose

`tests/stack/lib/stack.ts`'s `psqlAs`/`sqlApp`, used by `tests/stack/n8n/intake.test.ts` and `tests/stack/n8n/runtime.test.ts` to inspect `processed_events`, connect as `$APP_DB_USER`, not `app_runtime`. That's test tooling, not n8n: nothing in `workflows/` ever connects as `app`. AGENTS.md's documented false-duplicate recovery command (`docker compose exec -T postgres sh -c "psql -U \"\$APP_DB_USER\" -d app -c \"DELETE FROM processed_events WHERE event_id = '<request_uuid>'\""`) also runs as the owner role, deliberately: a manual recovery DELETE is an operator action, not a runtime path `app_runtime`'s grants need to cover, so it uses the role that already has full rights in `app` rather than widening the runtime role's grants just for this one rare case.

## Every statement and what covers it

Exactly one Postgres node exists across every workflow in `workflows/`: `lead-intake`'s "Record request". No other workflow, and no Chat Memory node, touches Postgres at all — checked by reading every `n8n-nodes-base.postgres` node straight from `workflows/*.json` (see `tests/check-db.test.ts`'s "workflow statements" describe block, which asserts there is exactly one).

| Workflow › node | Statement | Privileges it needs | Served by |
|---|---|---|---|
| `lead-intake` › Record request | `INSERT INTO processed_events (source, event_id) VALUES ('wordpress-lead', $1) ON CONFLICT DO NOTHING RETURNING event_id` | `INSERT` on `processed_events`; `SELECT` for the `ON CONFLICT` conflict check and the `RETURNING` read | primary key `(source, event_id)`, as the conflict arbiter |

So `app_runtime` holds exactly `SELECT, INSERT` on `processed_events` — no `UPDATE` (nothing ever updates a row; a replay just returns no `event_id`), no `DELETE` (nothing ever deletes one; see Retention below), and no DDL. `processed_events` has no serial or identity column, so there is no sequence to grant either (unlike a `GENERATED ALWAYS AS IDENTITY` primary key, whose implicit `nextval()` would still need no grant — demo 2 proved that case empirically; it doesn't arise here at all, since this table's key is `(source, event_id)`, not a sequence).

## The checklist

### 1. Roles

- **The schema owner isn't the runtime role.** `app` owns `processed_events` and `schema_migrations` (created by `db-migrate` under `SET LOCAL ROLE`). n8n's one Postgres credential, `App DB`, connects as `app_runtime`.
- **What `app_runtime` can't do.**
  - **DML only.** `SELECT, INSERT` on `processed_events`, nothing else: no DDL (`001_runtime_role.sql` runs `REVOKE CREATE ON SCHEMA public FROM PUBLIC` and grants it nothing on the schema beyond `USAGE`), no `TRUNCATE`, no column-level grant beyond its table grant, and no sequence privilege.
  - **No membership.** It's a member of no role, so it can't `SET ROLE` to the owner.
  - **No attributes.** `db-migrate` re-asserts `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS` every time it sets the password.
  - **No `n8n`.** `db/init/` revokes `PUBLIC`'s access, and `001_runtime_role.sql` revokes `app_runtime`'s own access explicitly.
  - **`CONNECT` on `app`, without `TEMP`.** `db/init/` revoked `PUBLIC`'s defaults there.
- **Its own name.** `db-migrate` refuses to run when `APP_RUNTIME_DB_USER` equals `POSTGRES_USER`, `N8N_DB_USER`, or `APP_DB_USER`, which would aim the runtime grants and password at another role.
- **No default privileges.** There's only one table today; a future one gets its own grant in its own migration.
- **The superuser stays out of n8n.** It runs only `db/init/` and `db-migrate`, and neither n8n container is configured with it.

### 2. Schema

- **Primary key:** `processed_events (source, event_id)`; `schema_migrations (filename)`.
- **`NOT NULL`:** every column on both tables is required (`source`, `event_id`, `received_at`; `filename`, `applied_at`) — there's no optional field on either.
- **Timestamps:** `processed_events.received_at` is `timestamptz`. There's no MySQL `datetime` on the Postgres side.

### 3. Indexes

The one query a production path runs is served by the primary key itself: `ON CONFLICT DO NOTHING RETURNING event_id` arbitrates on `(source, event_id)`, which is also what the conflict check reads. There's no secondary index, because there's no second query shape to serve — `processed_events` has exactly one writer and no reader in `workflows/`.

### 4. Queries

- **Bound values only.** The one Postgres node passes its value as a `$1` Query Parameter. `pnpm run check` rejects a query that contains a `{{ }}` expression inside the SQL text itself, and a `$n` placeholder inside a SQL comment.
- **The stack suite runs it for real.** Every stack test that sends a lead through `lead-intake` exercises this statement as `app_runtime` would run it in production; `check-db` additionally runs it directly, rolled back, as proof independent of a live lead.

### 5. Migrations

`db/schema.sql` is the baseline, which `db/init/` loads on an empty volume. Every change after it is a file in `db/migrations/`, named `NNN_short_name.sql`. `pnpm run db:migrate` (`scripts/db-migrate.ts`) applies them, and `pnpm run setup` runs it first. On each run, it:

1. **Checks the files and `.env` first.** It stops before touching the database in three cases, each naming files and variables, never a value:
   - A file contains a transaction-control statement (`BEGIN`, `COMMIT`, `ROLLBACK`, `ABORT`, `START TRANSACTION`, or `END`), which would split the file from its ledger row.
   - `APP_RUNTIME_DB_USER` names the same role as another role variable.
   - A variable that a pending file reads with `\getenv` is unset or empty.
2. **Opens the ledger.** As the owner role, it creates `schema_migrations` if it's missing, then reads the files already recorded there.
3. **Applies each pending file in order,** as the superuser over the `postgres` container's local socket, with `--single-transaction` and `ON_ERROR_STOP`. Each file's transaction first takes a fixed advisory lock (`pg_advisory_xact_lock`), so two runs can't interleave. A concurrent second run then fails on the ledger's primary key instead of recording a file twice. The `INSERT` into `schema_migrations` is the file's last statement, so a failed file leaves no change and no record.
4. **Sets `app_runtime`'s password and attributes** from `APP_RUNTIME_DB_PASSWORD`, even when no migration ran, with `ALTER ROLE … WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD …`. A hand-granted attribute doesn't survive the next run. `setup-credentials` rebuilds the `App DB` credential from `.env` on every run, so the role's password must follow it the same way. To rotate it, change `.env` and run `pnpm run setup`.

`db-migrate` passes each variable to `docker compose exec` as a bare `-e NAME`. Docker copies the value from `db-migrate`'s own environment, so it never appears in an argument list or in `ps`, and psql reads it with `\getenv`. A password reaches the server only inside `ALTER ROLE … PASSWORD`, which psql quotes itself. `db-migrate` redacts every `.env` secret from psql's output before printing an error.

Postgres also logs a failed statement's full text by default (`log_min_error_statement = error`), and `ALTER ROLE … PASSWORD` carries the password. So the password step first runs `SET LOCAL log_min_error_statement = panic` and `SET LOCAL log_statement = 'none'` inside its own transaction. `db/init/01-app.sh` does the same for its session before it creates the `n8n` and `app` roles, and reads each password with `\getenv` rather than a `-v` argument, so neither reaches `ps` either. It also stops at once if `N8N_DB_PASSWORD` or `APP_DB_PASSWORD` is empty — checked locally by searching `docker compose logs postgres` for the literal text `PASSWORD '` after a deliberately failed password statement: zero matches (see "The log proof" below).

`001_runtime_role.sql` is safe to run twice: it creates the role through `\gexec` only `WHERE NOT EXISTS`, and every `GRANT`/`REVOKE` statement is naturally idempotent. The ledger already skips applied files, so a second `pnpm run setup` prints `no pending migrations`.

### 6. Retention

**Postgres (`app` database):**

| Table | Personal/business data | Deleted by | When |
|---|---|---|---|
| `processed_events` | none — `event_id` is the lead's own `request_uuid`, an opaque identifier with no PII embedded | nothing | kept indefinitely; see the manual-prune note below |
| `schema_migrations` | none | nothing | it's the ledger |

`processed_events` holds no customer-identifying data itself (no name, phone, or email — just the opaque `request_uuid` and an arrival timestamp), so there's no privacy reason to prune it. It still grows by one row per lead forever, with no automatic job. A manual prune, run by hand against old rows once their corresponding WordPress lead is long past any possible retry or recovery need (see AGENTS.md's false-duplicate recovery, which depends on the row still existing):

```sh
docker compose exec -T postgres sh -c "psql -U \"\$APP_DB_USER\" -d app -c \"DELETE FROM processed_events WHERE received_at < now() - interval '2 years'\""
```

It runs as the owner role, like the recovery command: `app_runtime` has no `DELETE` on this table. The outer double quotes keep `\$APP_DB_USER` for the container's own shell to expand.

**MySQL (WordPress):**

| Table/option | Personal/business data | Deleted by | When |
|---|---|---|---|
| `wp_moving_quote_leads` | customer name, phone, email, move details | the WordPress Personal Data eraser (`Admin\PersonalData::erase()`, Tools → Erase Personal Data, keyed by email), or `uninstall.php` (drops the whole table) | on an explicit privacy-tools erase request, or when the plugin is deleted — never automatically otherwise |
| `moving_quote_settings`, `moving_quote_db_version` (options) | none (pricing/delivery config and a schema version number) | `uninstall.php` | when the plugin is deleted |
| rate-limit transients | none (a hashed IP, never the IP itself) | WordPress's own transient expiry, and `uninstall.php` on delete | within the transient's own window, or on uninstall |

So a lead's PII is kept until one of two things happens: the customer (or an admin on their behalf) files a privacy erasure request through WordPress's own Tools → Erase Personal Data screen, or the plugin itself is uninstalled (not merely deactivated — see AGENTS.md's "Install lifecycle"). There's no automatic time-based purge of lead rows; that's a deliberate choice documented here, not an oversight — a moving-quote lead is a sales record a real business would want to keep for its own commercial reasons until asked to delete it, the same way demo 2's invoices are kept as accounting records.

**n8n execution data:** `compose.yaml` keeps `EXECUTIONS_DATA_PRUNE=true` and `EXECUTIONS_DATA_MAX_AGE=168`, so n8n deletes executions after 168 hours. Every workflow in `workflows/` sets `settings.saveManualExecutions: false` (`tests/workflows.test.ts` iterates `workflows/` and asserts it for every file), so a manual run from the editor is never kept either:

- **`lead-intake`** carries the raw signed JWT (`Authorization` header, stored verbatim by n8n with no redaction — see AGENTS.md's "Security: what n8n 2.45.6 actually does with the stored token") and the lead's own PII (name, phone, email) once parsed.
- **`process-lead`** carries the same PII, since its one caller hands it the parsed lead directly.
- **`error-handler`** carries whatever the failing execution's own trigger or error payload held, which can include either workflow's data (see AGENTS.md's "Security" note on `$('On workflow error').first().json`).

A per-workflow carve-out wouldn't hold here any more than it does in the other three demos: every workflow in this repo either receives the lead directly or receives the failing execution's own payload, so all three are on the list.

### 7. Backup and restore

Two databases to back up: Postgres's `app` (n8n's own `n8n` database is covered too, see below) and WordPress's MySQL database. Both commands run from the `postgres`/`db` container's own client, so no port or password crosses the host, and a dump holds business data, so write it outside the repo at `0600`.

**Postgres — `app`:**

```bash
mkdir -p ~/chivabox-backups
(umask 077; docker compose exec -T postgres sh -c 'pg_dump -Fc -U "$POSTGRES_USER" -d app' > ~/chivabox-backups/app.dump)
```

**MySQL — WordPress.** `mysqldump` runs from the `db` container's own client, never `wp db export`: the `wpcli` image's bundled MariaDB client isn't guaranteed to work with MySQL 8.4's wire protocol (the same reason stack tests never use `wp db query`; see AGENTS.md).

```bash
(umask 077; docker compose exec -T db sh -c 'mysqldump -u root -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' > ~/chivabox-backups/wordpress.sql)
```

**Verifying each dump:** restore it into a scratch database, compare row counts against the original, then drop only the scratch database.

Postgres:

```bash
docker compose exec -T postgres sh -c 'createdb -U "$POSTGRES_USER" -O "$APP_DB_USER" app_restore_check'
docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d app_restore_check --exit-on-error' < ~/chivabox-backups/app.dump
for db in app app_restore_check; do
  docker compose exec -T postgres sh -c "psql -X -At -U \"\$APP_DB_USER\" -d $db -c \"SELECT 'processed_events', count(*) FROM processed_events UNION ALL SELECT 'schema_migrations', count(*) FROM schema_migrations\""
done
docker compose exec -T postgres sh -c 'dropdb -U "$POSTGRES_USER" app_restore_check'
```

MySQL:

```bash
docker compose exec -T db sh -c 'mysql -u root -p"$MYSQL_ROOT_PASSWORD" -e "CREATE DATABASE wordpress_restore_check"'
docker compose exec -T db sh -c 'mysql -u root -p"$MYSQL_ROOT_PASSWORD" wordpress_restore_check' < ~/chivabox-backups/wordpress.sql
for db in "$MYSQL_DATABASE" wordpress_restore_check; do
  docker compose exec -T db sh -c "mysql -u root -p\"\$MYSQL_ROOT_PASSWORD\" -N -e \"SELECT 'leads', count(*) FROM $db.wp_moving_quote_leads\""
done
docker compose exec -T db sh -c 'mysql -u root -p"$MYSQL_ROOT_PASSWORD" -e "DROP DATABASE wordpress_restore_check"'
```

Drop only the two `_restore_check` scratch databases afterward — never the real `app` or WordPress databases.

To restore over `app` itself, stop n8n first, so nothing writes during the restore: `docker compose stop n8n`, then `pg_restore -U "$POSTGRES_USER" -d app --clean --if-exists --exit-on-error`, then `docker compose start n8n`. Roles live at the server level, so a dump doesn't carry them; on a fresh volume, `db/init/` and `pnpm run db:migrate` recreate them from `.env`.

**n8n's own database** backs up the same way as `app`, with `-d n8n` instead. Its credentials are encrypted with `N8N_ENCRYPTION_KEY`, so keep that key, from `.env`, alongside the dump — a dump without the key restores workflows, but none of their credentials.

### 8. Connections

- **No published port.** `compose.yaml` publishes no port for the `postgres` or `db` (MySQL) service. Only containers on the Compose network reach them; dumps go through `docker compose exec`. The only published database-adjacent port is WordPress itself (`8080`), which is the application, not the database.
- **Where credentials live.** Only in `.env`, which git ignores, and in n8n's credential store, which `N8N_ENCRYPTION_KEY` encrypts.
- **Authentication by path.** n8n connects over the Compose network, where Postgres's `pg_hba.conf` requires `scram-sha-256`. Inside the `postgres` container, the local socket and loopback use the official image's `trust` default, which `db/init/`, `db-migrate`, and `check-db` rely on. Reaching that socket takes `docker exec`, and Docker access on the host is already root-equivalent.
- **No TLS on the network.** The Postgres credential sets `ssl: disable`, and WordPress's MySQL connection has no TLS configured either. That's a limit of this local, single-host demo.
- **What production would need:**
  - TLS with a CA-signed server certificate, and the client verifying it;
  - both databases on a private network or a managed service;
  - `pg_hba.conf` narrowed to n8n's own address;
  - no `trust` lines;
  - rotated passwords.

## MySQL: document, don't change

The MySQL side isn't part of this least-privilege port — WordPress's own database access pattern is left as-is, and documented here instead:

- **The WordPress DB user is non-root, but needs DDL.** `MYSQL_USER`/`MYSQL_PASSWORD` (`compose.yaml`'s `db` service) create a non-root MySQL user scoped to `MYSQL_DATABASE` alone (the official `mysql` image's own bootstrap grants that user full privileges on that one database, nothing server-wide). That's still full `ALL PRIVILEGES` on the `wordpress` database, DDL included — not DML-only the way `app_runtime` is on Postgres — because `dbDelta()` (WordPress core's own schema-migration helper, which `Install\Installer::activate()` and `::maybe_upgrade()` both call) issues `CREATE TABLE`/`ALTER TABLE` directly against the live connection, with no separate owner-vs-runtime role split the way this plugin's Postgres side now has. Narrowing it would break every WordPress core update and every plugin's own install/upgrade path, not just this one.
- **The plugin's own migration path.** `Install\Installer::maybe_upgrade()` runs on every `plugins_loaded`: when the stored `moving_quote_db_version` option differs from `Installer::DB_VERSION`, it reruns `dbDelta()` against `Install\Schema::sql()` and updates the option, so an existing site picks up a schema change on its very next request — no separate migration runner, no ledger table, the way Postgres's `db/migrations/` has one. `dbDelta()` itself is idempotent (it diffs the live table against the `CREATE TABLE` text and only applies what's missing), which is what makes rerunning it on every mismatched version safe.
- **The leads table keeps PII until the privacy eraser or uninstall.** See Retention above: `wp_moving_quote_leads` holds customer name, phone, email, and move details, kept indefinitely until `Admin\PersonalData::erase()` (WordPress's own privacy-tools eraser, keyed by email) or `uninstall.php` removes it. There's no time-based auto-purge.
- **`datetime` columns hold UTC.** `Install\Schema::sql()`'s `created_at`, `consent_at`, and `sent_at` are plain MySQL `datetime` columns, written by `$wpdb` (WordPress core's own database layer), which stores whatever PHP `DateTimeImmutable`/`current_time('mysql', true)`-style value the plugin passes — this plugin always writes UTC, converting only for display (e.g. the leads admin page's "Received" column, shown in `America/Bogota`; see AGENTS.md's "Leads admin"). A `datetime` column carries no timezone of its own, so this is a convention this plugin follows consistently, not something MySQL enforces.
- **`processed_events` growth and MySQL's own tables are two separate concerns.** `wp_moving_quote_leads` grows with real leads and is pruned by the privacy tools or uninstall, as above; Postgres's `processed_events` grows by opaque ids only and has its own manual-prune statement (see Retention above) — the two tables track different things (a lead's full record vs. an idempotency marker) and are never pruned by the same mechanism.

## Credentials

`scripts/setup-credentials.ts` skips an existing credential in n8n unless it's named with `--refresh <id>` (any number of times) — re-importing a credential replaces it, which would otherwise drop an interactive Google sign-in for the Sheets/Gmail credentials. The App DB credential's fixed id is `cvbCredAppDb0001` (`scripts/lib/manifest.ts`'s `CREDENTIALS`).

**The one-time upgrade for an existing local stack.** A volume created before this change has the `App DB` credential already imported, connecting as `app` (the owner role) rather than `app_runtime`. After pulling this change and adding the two new `.env` names (or regenerating `.env` on a fresh volume), run:

```bash
pnpm run setup
pnpm run setup -- --refresh cvbCredAppDb0001
```

The first `pnpm run setup` applies `001_runtime_role.sql` and sets `app_runtime`'s password, but skips re-importing `App DB` because it already exists in n8n (still pointed at `app`, the owner role, at this point). The second call's `--refresh cvbCredAppDb0001` is what actually replaces the credential's connection details with `app_runtime`'s. Running `pnpm run setup` again afterward applies nothing and re-imports nothing.

**What `check-db` can't detect.** `check-db` proves `app_runtime`'s grants in Postgres are exactly right, and that the one workflow statement runs under them. It has no way to inspect what connection details an *already-imported* n8n credential actually holds — n8n's credential store is encrypted, and `setup-credentials.ts` only ever reads back an encrypted export's ids, never decrypted `data` (see AGENTS.md's Guardrails). So a stale `App DB` credential still pointed at the owner role, left over from before this change and never refreshed, is invisible to `check-db`: the Postgres-side checks all still pass (the owner role can do everything `app_runtime` can and more), and nothing here can tell the two states apart from the database side alone. The only way to confirm the credential itself was refreshed is the upgrade step above, run once by hand.
