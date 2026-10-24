import js from '@eslint/js';
import globals from 'globals';

/** Flat ESLint config. k6 scripts run in k6's own JS runtime, not Node, so they get k6 globals. */
export default [
  { ignores: ['node_modules/**', 'reports/**'] },
  js.configs.recommended,
  {
    files: ['lib/**/*.js', 'scenarios/**/*.js', 'experiments/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { __ENV: 'readonly', __VU: 'readonly', __ITER: 'readonly' },
    },
  },
  {
    files: ['scripts/**/*.mjs', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: globals.node },
  },
  {
    rules: {
      'no-unused-vars': ['error', { args: 'none' }],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
    },
  },
];
