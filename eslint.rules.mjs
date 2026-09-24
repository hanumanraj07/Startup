// Shared custom rules, kept separate from eslint.config.mjs so apps/web can
// layer them on top of Next's own bundled typescript-eslint config without
// redeclaring the @typescript-eslint plugin (flat config errors on that).
export const customRules = {
  // ai/coding-rules.md: no `any`, no non-null assertions.
  '@typescript-eslint/no-explicit-any': 'error',
  '@typescript-eslint/no-non-null-assertion': 'error',
  '@typescript-eslint/no-unused-vars': [
    'error',
    { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
  ],
  'no-console': ['warn', { allow: ['warn', 'error'] }],
};
