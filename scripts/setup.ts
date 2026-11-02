import { dbMigrate } from './db-migrate.ts';
import { parseRefreshIds, setupCredentials } from './setup-credentials.ts';
import { importWorkflows } from './import-workflows.ts';

async function main(): Promise<void> {
  const refresh = parseRefreshIds(process.argv.slice(2));

  await dbMigrate();
  await setupCredentials({ refresh });
  await importWorkflows();
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
