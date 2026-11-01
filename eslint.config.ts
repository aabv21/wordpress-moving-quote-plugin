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
    files: ['src/frontend/**'],
    rules: {
      'no-restricted-globals': ['error', 'process', 'Buffer', 'require'],
    },
  },
]);
