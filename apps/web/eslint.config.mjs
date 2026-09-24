import { FlatCompat } from '@eslint/eslintrc';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import globals from 'globals';
import prettier from 'eslint-config-prettier';
import { customRules } from '../../eslint.rules.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

export default [
  { ignores: ['.next/**', 'coverage/**', 'node_modules/**'] },
  // Next bundles its own @typescript-eslint config; layering the root
  // config's typescript-eslint block on top would redeclare the plugin.
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: customRules,
  },
  prettier,
];
