import eslint from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import importPlugin from 'eslint-plugin-import';
import nPlugin from 'eslint-plugin-n';
import sonarjs from 'eslint-plugin-sonarjs';
import globals from 'globals';

const tsLanguageOptions = {
  parser: tsparser,
  parserOptions: {
    ecmaVersion: 2021,
    sourceType: 'module',
  },
  globals: {
    ...globals.node,
  },
};

const tsPlugins = {
  n: nPlugin,
  '@typescript-eslint': /** @type {any} */ (tseslint),
  sonarjs: sonarjs,
  import: importPlugin,
};

const commonRules = {
  'n/prefer-node-protocol': 'error',
  ...tseslint.configs.recommended.rules,
  '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
  quotes: ['error', 'single'],
  'sort-imports': [
    'error',
    {
      ignoreCase: true,
      ignoreDeclarationSort: true,
      ignoreMemberSort: false,
      memberSyntaxSortOrder: ['none', 'all', 'multiple', 'single'],
    },
  ],
  '@typescript-eslint/consistent-type-imports': 'error',
  'sonarjs/cognitive-complexity': ['error', 10],
  'max-nested-callbacks': ['error', 4],
  'max-depth': ['error', 4],
  'import/first': 'error',
  'import/no-namespace': 'error',
};

export default [
  eslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: tsLanguageOptions,
    plugins: tsPlugins,
    rules: {
      ...commonRules,
      'max-lines-per-function': ['error', 100],
    },
  },
  {
    files: ['test/**/*.ts'],
    languageOptions: tsLanguageOptions,
    plugins: tsPlugins,
    rules: commonRules,
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    plugins: {
      n: nPlugin,
    },
    rules: {
      'n/prefer-node-protocol': 'error',
    },
  },
];
