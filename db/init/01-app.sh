#!/bin/sh
# Runs once, on an empty volume (docker-entrypoint-initdb.d). Creates the n8n
# and app roles/databases, then loads the schema as the app role.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v n8n_pw="$N8N_DB_PASSWORD" -v app_pw="$APP_DB_PASSWORD" <<SQL
CREATE ROLE "$N8N_DB_USER" LOGIN PASSWORD :'n8n_pw';
CREATE DATABASE n8n OWNER "$N8N_DB_USER";
REVOKE ALL ON DATABASE n8n FROM PUBLIC;

CREATE ROLE "$APP_DB_USER" LOGIN PASSWORD :'app_pw';
CREATE DATABASE app OWNER "$APP_DB_USER";
REVOKE ALL ON DATABASE app FROM PUBLIC;
SQL

psql -v ON_ERROR_STOP=1 --username "$APP_DB_USER" --dbname app -f /schema/schema.sql
