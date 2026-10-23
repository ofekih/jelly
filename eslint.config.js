import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'functions', '.claude', 'node_modules'] },
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { ecmaVersion: 2022, globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Firestore docs and legacy local copies are parsed from untyped JSON
      '@typescript-eslint/no-explicit-any': 'off',
      // tsc already reports unused locals and parameters
      '@typescript-eslint/no-unused-vars': 'off',
    },
  }
);
