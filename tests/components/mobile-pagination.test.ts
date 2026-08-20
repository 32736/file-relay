import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import MobileFiles from '../../src/components/mobile/MobileFiles.vue'
import MobileShares from '../../src/components/mobile/MobileShares.vue'

const file = (id: string) => ({
  id,
  name: `${id}.txt`,
  size: 1024,
  mimeType: 'text/plain',
  createdAt: 1700000000,
})

const share = (id: string) => ({
  id,
  fileId: `file-${id}`,
  fileName: `${id}.txt`,
  createdAt: 1700000000,
  expiresAt: null,
  maxDownloads: null,
  downloadCount: 0,
  revokedAt: null,
  url: null,
})

function setNearBottom(element: HTMLElement): void {
  Object.defineProperties(element, {
    scrollHeight: { configurable: true, value: 1000 },
    clientHeight: { configurable: true, value: 300 },
    scrollTop: { configurable: true, value: 750 },
  })
}

describe('mobile infinite list pagination', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads the next file page when the list nears the bottom', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost')
      const cursor = url.searchParams.get('cursor')
      const body = cursor
        ? { files: [file('file-21')], nextCursor: null }
        : { files: [file('file-1')], nextCursor: '20' }
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(MobileFiles)
    await flushPromises()
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('limit=20')

    const scroll = wrapper.get('.list-scroll')
    setNearBottom(scroll.element)
    await scroll.trigger('scroll')
    await flushPromises()

    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain('cursor=20')
    expect(wrapper.text()).toContain('file-21.txt')
  })

  it('loads the next share page when the list nears the bottom', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost')
      const cursor = url.searchParams.get('cursor')
      const body = cursor
        ? { shares: [share('share-21')], nextCursor: null }
        : { shares: [share('share-1')], nextCursor: '20' }
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(MobileShares)
    await flushPromises()
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('limit=20')

    const scroll = wrapper.get('.list-scroll')
    setNearBottom(scroll.element)
    await scroll.trigger('scroll')
    await flushPromises()

    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain('cursor=20')
    expect(wrapper.text()).toContain('share-21.txt')
  })
})
