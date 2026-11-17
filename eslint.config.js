// ESLint "flat" config: one file for the whole monorepo.
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

// Globals that Node.js 22 provides, for the plain .mjs scripts under spikes/.
const nodeGlobals = Object.fromEntries(
  [
    'AbortController',
    'Buffer',
    'TextDecoder',
    'TextEncoder',
    'URL',
    'URLSearchParams',
    'WebSocket',
    'clearInterval',
    'clearTimeout',
    'console',
    'fetch',
    'performance',
    'process',
    'setInterval',
    'setTimeout',
  ].map((name) => [name, 'readonly']),
);

export default [
  // Never lint build output, installed packages or the generated Expo sample app.
  {
    ignores: ['**/dist/**', '**/node_modules/**', 'coverage/**', 'spikes/r0/sample-app/**'],
  },

  // Base JavaScript rules, then the TypeScript rules on top.
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Spike scripts are plain JavaScript modules run by Node.js.
  {
    files: ['spikes/**/*.mjs'],
    languageOptions: { globals: nodeGlobals },
  },

  // Last on purpose: turns off style rules that Prettier already handles.
  prettier,
];
