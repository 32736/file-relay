import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import ShareList from '../../src/components/ShareList.vue'

describe('ShareList', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('lists shares and revokes one', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/shares?') && (init?.method ?? 'GET') === 'GET') {
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
                url: 'https://drop.28207.cc/s/cross-device-token',
              },
            ],
            nextCursor: null,
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
    expect(String(mock.mock.calls[0]?.[0])).toContain('limit=10')
    expect(wrapper.get('input').attributes('autofocus')).toBeUndefined()
    expect(wrapper.text()).toContain('a.pdf')
    expect(wrapper.text()).toContain('1 / 3')
    expect(wrapper.text()).toContain('有效')
    expect(wrapper.get('.pagination-page[aria-current="page"]').text()).toBe('1')
    // Server-recovered URL (same account, any device) enables the copy button.
    const copyButton = wrapper.find('button[title="复制链接"]')
    expect(copyButton.exists()).toBe(true)
    await copyButton.trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenCalledWith('https://drop.28207.cc/s/cross-device-token')

    await wrapper.find('button.danger').trigger('click')
    await flushPromises()
    expect(mock.mock.calls.some((call) => String(call[0]).includes('/shares/s1') && call[1]?.method === 'DELETE')).toBe(true)
  })

  it('paginates shares with ten items per page', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost')
      const cursor = url.searchParams.get('cursor')
      const shares = cursor
        ? [{ id: 's11', fileId: 'f11', fileName: '第十一项.txt', createdAt: 1, expiresAt: null, maxDownloads: null, downloadCount: 0, deleteFileAfterExhausted: false, revokedAt: null, url: null }]
        : Array.from({ length: 10 }, (_, index) => ({
            id: `s${index + 1}`,
            fileId: `f${index + 1}`,
            fileName: `第${index + 1}项.txt`,
            createdAt: index + 1,
            expiresAt: null,
            maxDownloads: null,
            downloadCount: 0,
            deleteFileAfterExhausted: false,
            revokedAt: null,
            url: null,
          }))
      return new Response(JSON.stringify({ shares, nextCursor: cursor ? null : '10' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(ShareList)
    await flushPromises()
    expect(wrapper.findAll('tbody tr')).toHaveLength(10)
    expect(wrapper.get('.pagination-page[aria-current="page"]').text()).toBe('1')

    await wrapper.get('select[aria-label="分享列表每页条数"]').setValue('20')
    await flushPromises()
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain('limit=20')

    await wrapper.get('.pagination button[aria-label="下一页"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('第十一项.txt')
    expect(wrapper.get('.pagination-page[aria-current="page"]').text()).toBe('2')
  })
})
