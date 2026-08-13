/// <reference types="vitest/config" />

import { cloudflare } from '@cloudflare/vite-plugin'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

export default defineConfig(({ mode }) => ({
  plugins: [vue(), ...(mode === 'test' ? [] : [cloudflare()])],
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
  },
}))
