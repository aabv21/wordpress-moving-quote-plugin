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
    // Enforces AGENTS.md's rule: `stack.ts` loads `.env` at import time, and `execution-data.ts`,
    // `leads.ts`, and `signed-lead.ts` import it, so none may reach a test outside `tests/stack/**` (CI's quality
    // job has no `.env`). The modules are listed by name because a `!` pattern can't carve the
    // side-effect-free ones (`poll.ts`, `jwt.ts`, `receiver.ts`) out of a glob. Add any new
    // `tests/stack/lib/` file that loads `.env` or needs a live stack.
    files: ['tests/**'],
    ignores: ['tests/stack/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/stack/lib/stack.ts', '**/stack/lib/stack', '**/stack/lib/execution-data.ts', '**/stack/lib/execution-data', '**/stack/lib/leads.ts', '**/stack/lib/leads', '**/stack/lib/signed-lead.ts', '**/stack/lib/signed-lead'],
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
    // Browser code: no Node builtins. Every computed index is a typed key or a bounded position,
    // which the object-injection rule can't see.
    files: ['src/frontend/**'],
    rules: {
      'no-restricted-globals': ['error', 'process', 'Buffer', 'require'],
      'security/detect-object-injection': 'off',
    },
  },
]);
