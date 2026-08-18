/// <reference types="vitest/config" />

import { cloudflare } from '@cloudflare/vite-plugin'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

export default defineConfig(({ mode }) => ({
  plugins: [
    // Under vitest there is no dev server, so plugin-vue compiles template
    // asset URLs such as `/logo.svg` into module imports that vite-node
    // cannot resolve (public-dir assets). Keep them as literal URLs in tests.
    vue(mode === 'test' ? { template: { transformAssetUrls: false } } : {}),
    ...(mode === 'test' ? [] : [cloudflare()]),
  ],
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
  },
}))
