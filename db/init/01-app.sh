#!/bin/sh
# Runs once, on an empty volume (docker-entrypoint-initdb.d). Creates the n8n
# and app roles/databases, then loads the schema as the app role. psql reads
# each password from the environment itself (\getenv), so none reaches argv,
# and the session keeps failed statements, which would carry a password, out
# of the server log. Later changes, the runtime role included, are
# db/migrations/, applied by pnpm run db:migrate.
set -eu
: "${N8N_DB_PASSWORD:?must be set in .env}" "${APP_DB_PASSWORD:?must be set in .env}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<SQL
SET log_min_error_statement = panic;
SET log_statement = 'none';
\getenv n8n_pw N8N_DB_PASSWORD
\getenv app_pw APP_DB_PASSWORD
CREATE ROLE "$N8N_DB_USER" LOGIN PASSWORD :'n8n_pw';
CREATE DATABASE n8n OWNER "$N8N_DB_USER";
REVOKE ALL ON DATABASE n8n FROM PUBLIC;

CREATE ROLE "$APP_DB_USER" LOGIN PASSWORD :'app_pw';
CREATE DATABASE app OWNER "$APP_DB_USER";
REVOKE ALL ON DATABASE app FROM PUBLIC;
SQL

psql -v ON_ERROR_STOP=1 --username "$APP_DB_USER" --dbname app -f /schema/schema.sql
