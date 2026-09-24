// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import { customRules } from './eslint.rules.mjs';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/*.d.ts',
      'infra/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: customRules,
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/vitest.config.ts', '**/*.config.ts', '**/*.config.mjs'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },
  {
    // Seed scripts are throwaway CLI tooling over locally-hardcoded, fully-known
    // data (not the "value that can be absent" case the no-non-null-assertion
    // rule exists to catch), and printing progress is their entire job.
    files: ['**/prisma/seed*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-console': 'off',
    },
  },
  prettier,
);
