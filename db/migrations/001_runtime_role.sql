-- The runtime role n8n's app credential connects as: DML on the table listed below and nothing
-- else, so no DDL, no TRUNCATE, and no access to n8n's own database. docs/database.md maps the
-- one statement the workflows issue to the grant that covers it. db-migrate sets the role's
-- password from APP_RUNTIME_DB_PASSWORD after every run, so this file only creates the role.
\getenv runtime_role APP_RUNTIME_DB_USER

SELECT format('CREATE ROLE %I LOGIN', :'runtime_role')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'runtime_role')
\gexec

-- Postgres 15 and later already withhold CREATE on public from PUBLIC; this states it outright.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON DATABASE n8n FROM :"runtime_role";
GRANT CONNECT ON DATABASE app TO :"runtime_role";
GRANT USAGE ON SCHEMA public TO :"runtime_role";

-- lead-intake's "Record request" is the only writer: an INSERT ... ON CONFLICT DO NOTHING
-- RETURNING event_id, so it needs INSERT, and SELECT for the conflict check and the RETURNING
-- read. No other workflow touches Postgres. processed_events has no serial or identity column,
-- so there is no sequence to grant either.
GRANT SELECT, INSERT ON processed_events TO :"runtime_role";
