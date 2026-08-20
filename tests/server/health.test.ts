import { describe, expect, it } from 'vitest'

import { app } from '../../server/index'

describe('Worker API', () => {
  it('reports readiness without exposing environment details', async () => {
    const response = await app.request('/api/health')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin')
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('returns a structured response for an unknown API route', async () => {
    const response = await app.request('/api/missing')

    expect(response.status).toBe(404)
    expect(response.headers.get('x-frame-options')).toBe('DENY')
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'API route not found',
      },
    })
  })
})
