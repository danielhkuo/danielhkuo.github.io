/*
*   .eslintrc.cjs
*/
module.exports = {
    // This file is an override that applies only to files in this folder.
    // Do not stop ESLint from merging with the root configuration.
    // root flag intentionally omitted so that settings from the root config propagate.
    env: {
      browser: true,
      es2022: true,
      node: true,
    },
    // Base parser for TypeScript
    parser: '@typescript-eslint/parser',
    parserOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      // Point to the workspace-level tsconfig for type-aware linting
      project: '../../tsconfig.json',
    },
    // Base plugins
    plugins: [
      '@typescript-eslint',
      'jsx-a11y'
    ],
    // Start with good defaults
    extends: [
      'eslint:recommended',
      'plugin:@typescript-eslint/recommended',
      // This is the key for Astro!
      'plugin:astro/recommended',
      'plugin:jsx-a11y/recommended',
    ],
    // Rules for specific file types
    overrides: [
      {
        // Rules for Astro files
        files: ['*.astro'],
        parser: 'astro-eslint-parser',
        parserOptions: {
          // The Astro parser needs to know what parser to use for <script> tags
          parser: '@typescript-eslint/parser',
          extraFileExtensions: ['.astro'],
        },
        rules: {
          // Astro components can have top-level `await`
          'no-unused-vars': 'off', // The Astro compiler will catch unused vars
        },
      },
      {
        // Rules for Svelte files
        files: ['*.svelte'],
        parser: 'svelte-eslint-parser',
        parserOptions: {
          // The Svelte parser needs to know what parser to use for <script> tags
          parser: '@typescript-eslint/parser',
        },
        // You can add svelte3/recommended here if you want Svelte-specific rules
        extends: ['plugin:svelte/recommended'],
        rules: {
          // Svelte-specific rule overrides can go here
        }
      },
    ],
  };