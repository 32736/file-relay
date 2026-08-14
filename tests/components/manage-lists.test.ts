import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import IncomingList from '../../src/components/IncomingList.vue'
import ShareList from '../../src/components/ShareList.vue'

function stubClipboard(): void {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  })
}

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

describe('IncomingList', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('creates an incoming request and copies the link', async () => {
    stubClipboard()
    const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/incoming-requests' && init?.method === 'POST') {
        return new Response(
          JSON.stringify({ id: 'r1', url: 'https://drop.28207.cc/u/abc' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      if (url === '/api/incoming-requests' && (init?.method ?? 'GET') === 'GET') {
        return new Response(JSON.stringify({ requests: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response('not found', { status: 404 })
    })
    vi.stubGlobal('fetch', mock)

    const wrapper = mount(IncomingList)
    await flushPromises()

    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://drop.28207.cc/u/abc')
    expect(wrapper.text()).toContain('链接已复制到剪贴板')
  })

  it('lists incoming requests and revokes', async () => {
    const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/incoming-requests' && (init?.method ?? 'GET') === 'GET') {
        return new Response(
          JSON.stringify({
            requests: [
              {
                id: 'r1',
                title: '给我文件',
                createdAt: 1700000000,
                expiresAt: 1900000000,
                maxFiles: 5,
                maxFileSize: 10485760,
                uploadedCount: 2,
                revokedAt: null,
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      if (url === '/api/incoming-requests/r1' && init?.method === 'DELETE') {
        return new Response(null, { status: 204 })
      }
      return new Response('not found', { status: 404 })
    })
    vi.stubGlobal('fetch', mock)

    const wrapper = mount(IncomingList)
    await flushPromises()
    expect(wrapper.text()).toContain('给我文件')
    expect(wrapper.text()).toContain('2 / 5')
    expect(wrapper.text()).toContain('有效')

    await wrapper.find('button.danger').trigger('click')
    await flushPromises()
    expect(
      mock.mock.calls.some((call) => String(call[0]).includes('/incoming-requests/r1') && call[1]?.method === 'DELETE'),
    ).toBe(true)
  })
})
