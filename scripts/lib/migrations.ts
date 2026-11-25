/** Shared by `db-migrate` and `check-db`: what a migration file is called, its order, and which `.env` names it needs. */
export const MIGRATIONS_DIR = 'db/migrations';

/** `NNN_short_name.sql`: a three-digit sequence number, then a lowercase name. */
export const MIGRATION_NAME = /^(\d{3})_[a-z0-9_]+\.sql$/;

/** Throws on a misnamed file or a reused sequence number. */
export function orderMigrations(fileNames: readonly string[]): string[] {
  const files = fileNames.filter((name) => name.endsWith('.sql')).sort();
  const seen = new Map<string, string>();
  for (const file of files) {
    const sequence = MIGRATION_NAME.exec(file)?.[1];
    if (sequence === undefined) throw new Error(`${MIGRATIONS_DIR}/${file}: name it like 001_short_name.sql`);
    const other = seen.get(sequence);
    if (other !== undefined) throw new Error(`${MIGRATIONS_DIR}: ${other} and ${file} share ${sequence}; renumber one`);
    seen.set(sequence, file);
  }
  return files;
}

export function pendingMigrations(files: readonly string[], applied: ReadonlySet<string>): string[] {
  return files.filter((file) => !applied.has(file));
}

/** Compose turns an unset name into an empty one, so both count as missing. */
export function missingEnv(names: readonly string[], env: Readonly<Record<string, string | undefined>>): string[] {
  // eslint-disable-next-line security/detect-object-injection -- name comes from a migration's own \getenv line, not user input
  return names.filter((name) => !env[name]);
}

/** Names variables only, never a value. */
export function missingEnvError(source: string, missing: readonly string[]): Error {
  const verb = missing.length === 1 ? 'is' : 'are';
  return new Error(`${source} needs ${missing.join(', ')}, which ${verb} not set in .env; see .env.example and docs/database.md`);
}

