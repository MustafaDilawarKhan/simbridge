// ESLint "flat" config: one file for the whole monorepo.
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default [
  // Never lint build output or installed packages.
  { ignores: ['**/dist/**', '**/node_modules/**', 'coverage/**'] },

  // Base JavaScript rules, then the TypeScript rules on top.
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Last on purpose: turns off style rules that Prettier already handles.
  prettier,
];
