import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

test("the eraser's retention days match n8n's EXECUTIONS_DATA_MAX_AGE", () => {
  const php = readFileSync('plugin/moving-quote/src/Admin/PersonalData.php', 'utf8');
  const days = Number(/const EXECUTION_RETENTION_DAYS = (\d+);/.exec(php)?.[1]);
  const compose = readFileSync('compose.yaml', 'utf8');
  const hours = Number(/EXECUTIONS_DATA_MAX_AGE: "(\d+)"/.exec(compose)?.[1]);

  expect(days).toBeGreaterThan(0);
  expect(days * 24).toBe(hours);
});
