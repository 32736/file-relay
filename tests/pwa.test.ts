import { describe, expect, it, vi } from 'vitest'

import { registerServiceWorker } from '../src/lib/pwa'

describe('Phase 09 PWA', () => {
  it('manifest exists and declares installability + share target', async () => {
    const manifest = (await import('../public/manifest.webmanifest?raw')).default
    const parsed = JSON.parse(manifest) as {
      name: string
      start_url: string
      display: string
      icons: { purpose: string }[]
      theme_color: string
      share_target: { action: string; method: string }
    }
    expect(parsed.name).toBe('Drop')
    expect(parsed.start_url).toBe('/')
    expect(parsed.display).toBe('standalone')
    expect(parsed.icons.length).toBeGreaterThan(0)
    expect(parsed.icons.some((icon) => icon.purpose === 'maskable')).toBe(true)
    expect(parsed.theme_color).toBeTruthy()
    expect(parsed.share_target.action).toBe('/')
    expect(parsed.share_target.method).toBe('POST')
  })

  it('index.html links the manifest and theme color', async () => {
    const html = (await import('../index.html?raw')).default
    expect(html).toContain('rel="manifest" href="/manifest.webmanifest"')
    expect(html).toContain('name="theme-color"')
    expect(html).toContain('apple-touch-icon')
  })

  it('registers the service worker only in production', () => {
    const register = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(globalThis.navigator, 'serviceWorker', {
      value: { register },
      configurable: true,
    })

    registerServiceWorker({ PROD: true })
    expect(register).toHaveBeenCalledWith('/sw.js')

    register.mockClear()
    registerServiceWorker({ PROD: false })
    expect(register).not.toHaveBeenCalled()
  })

  it('sw.js exists with the API passthrough and shell cache', async () => {
    const sw = (await import('../public/sw.js?raw')).default
    expect(sw).toContain("startsWith('/api/')")
    expect(sw).toContain("SHELL_CACHE")
    expect(sw).toContain('network-first')
  })
})
