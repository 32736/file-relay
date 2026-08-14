import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import ShareList from '../../src/components/ShareList.vue'

describe('ShareList', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('lists shares and revokes one', async () => {
    const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/shares' && (init?.method ?? 'GET') === 'GET') {
        return new Response(
          JSON.stringify({
            shares: [
              {
                id: 's1',
                fileId: 'f1',
                fileName: 'a.pdf',
                createdAt: 1700000000,
                expiresAt: null,
                maxDownloads: 3,
                downloadCount: 1,
                deleteFileAfterExhausted: false,
                revokedAt: null,
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      if (url === '/api/shares/s1' && init?.method === 'DELETE') {
        return new Response(null, { status: 204 })
      }
      return new Response('not found', { status: 404 })
    })
    vi.stubGlobal('fetch', mock)

    const wrapper = mount(ShareList)
    await flushPromises()
    expect(wrapper.text()).toContain('a.pdf')
    expect(wrapper.text()).toContain('1 / 3')
    expect(wrapper.text()).toContain('有效')

    await wrapper.find('button.danger').trigger('click')
    await flushPromises()
    expect(mock.mock.calls.some((call) => String(call[0]).includes('/shares/s1') && call[1]?.method === 'DELETE')).toBe(true)
  })
})
