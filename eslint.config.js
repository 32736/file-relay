import eslint from '@eslint/js'
import vue from 'eslint-plugin-vue'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', '.wrangler/**', 'node_modules/**', 'worker-configuration.d.ts'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...vue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
    },
    rules: {
      // TypeScript (vue-tsc) already reports undefined identifiers; the core
      // no-undef rule misfires on browser globals in SFC script blocks.
      'no-undef': 'off',
    },
  },
  {
    files: ['public/**/*.js'],
    languageOptions: {
      globals: {
        self: 'readonly',
        caches: 'readonly',
        clients: 'readonly',
        skipWaiting: 'readonly',
        claim: 'readonly',
        URL: 'readonly',
        Request: 'readonly',
        Response: 'readonly',
        fetch: 'readonly',
        addEventListener: 'readonly',
        indexedDB: 'readonly',
        File: 'readonly',
        FormData: 'readonly',
      },
    },
  },
  {
    rules: {
      'vue/multi-word-component-names': 'off',
    },
  },
)
