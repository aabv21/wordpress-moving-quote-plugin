import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import security from 'eslint-plugin-security';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores(['node_modules/', 'plugin/moving-quote/assets/', 'plugin/moving-quote/vendor/', 'vendor/', 'workflows/']),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  security.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // Tests read fixtures by computed path, index them by computed key, use
    // arrow-shorthand `expect`, and assert with `!` on values already checked.
    files: ['tests/**'],
    rules: {
      'security/detect-non-literal-fs-filename': 'off',
      'security/detect-object-injection': 'off',
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    // `tests/stack/lib/stack.ts` calls `process.loadEnvFile('.env')` at import time, and
    // `tests/stack/lib/execution-data.ts` and `tests/stack/lib/leads.ts` both import `stack.ts`
    // transitively, so importing any of the three outside `tests/stack/**` — even indirectly
    // through another helper — would fail the moment it ran without a stack up, or without
    // `.env` (CI's Quality job has neither). `tests/stack/wp/**` and `tests/stack/n8n/**` files
    // themselves are outside this rule's `files` glob already, so this only reaches a test
    // elsewhere that reached into `tests/stack/**` by hand. This rule backs the convention
    // documented in AGENTS.md with an enforced one, instead of relying on it alone.
    //
    // `no-restricted-imports`'s own glob patterns don't support excluding a subset of a wildcard
    // match (a `!`-prefixed pattern is matched literally, not treated as a negation), so the
    // stack-only modules are named explicitly instead of matching `**/stack/**` and trying to
    // carve out `tests/stack/**`'s side-effect-free ones (`lib/poll.ts`, `lib/jwt.ts`,
    // `lib/receiver.ts` today — no `.env` load and no live-stack dependency at import time, so
    // importing any of them directly is fine). A new file under `tests/stack/lib/` that itself
    // loads `.env` or needs a live stack must be added to this list.
    files: ['tests/**'],
    ignores: ['tests/stack/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/stack/lib/stack.ts', '**/stack/lib/stack', '**/stack/lib/execution-data.ts', '**/stack/lib/execution-data', '**/stack/lib/leads.ts', '**/stack/lib/leads'],
              message: 'Only tests/stack/** may import this; it needs a live stack (and, for stack.ts, a loaded .env).',
            },
            {
              group: ['**/stack/wp/**', '**/stack/n8n/**', '**/stack/global-setup*'],
              message: 'Only tests/stack/** may import a stack test file directly.',
            },
          ],
        },
      ],
    },
  },
  {
    // The Code-node sandbox has neither Node builtins, fetch, nor a DOM, and Luxon must stay a
    // global (see src/globals.d.ts) so esbuild doesn't bundle it into the generated jsCode.
    files: ['src/nodes/**'],
    rules: {
      'no-restricted-imports': ['error', { paths: ['luxon'], patterns: ['node:*'] }],
      'no-restricted-globals': ['error', 'process', 'fetch', 'window', 'document'],
    },
  },
  {
    // The frontend runs in the browser: no Node builtins, no process, no Buffer, no require.
    // Every computed index here is a statically-typed key (keyof FormValues, a 0|1|2 step, a
    // byte 0-255) or a bounded array position, never an unvalidated string from the network; the
    // rule can't see TypeScript's types and flags every computed index as if it were.
    files: ['src/frontend/**'],
    rules: {
      'no-restricted-globals': ['error', 'process', 'Buffer', 'require'],
      'security/detect-object-injection': 'off',
    },
  },
]);
