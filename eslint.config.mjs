import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import unusedImports from 'eslint-plugin-unused-imports';

export default tseslint.config(
  // Global ignores
  {
    ignores: ['dist/', 'coverage/', 'node_modules/', 'examples/', '*.config.*'],
  },

  // Base JS recommended rules
  js.configs.recommended,

  // TypeScript strict type-checked rules
  ...tseslint.configs.recommended,

  // Custom rules for src/
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'unused-imports': unusedImports,
    },
    rules: {
      // ─── No explicit any ─────────────────────────────────────────────
      '@typescript-eslint/no-explicit-any': 'warn',

      // ─── No console (use logger instead) ─────────────────────────────
      'no-console': 'warn',

      // ─── Unused imports ──────────────────────────────────────────────
      'unused-imports/no-unused-imports': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // ─── React Hooks rules ───────────────────────────────────────────
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // ─── TypeScript strictness ───────────────────────────────────────
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  // Relaxed rules for test files
  {
    files: ['tests/**/*.{ts,tsx}'],
    plugins: {
      'unused-imports': unusedImports,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'warn',
    },
  },
);
