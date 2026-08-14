import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import SharePage from '../../src/components/SharePage.vue'

const META = {
  name: '报告.pdf',
  size: 2048,
  mimeType: 'application/pdf',
  expiresAt: null,
  remainingDownloads: 3,
  passwordRequired: false,
}

function stubFetch(overrides: Partial<Record<string, number>> = {}): ReturnType<typeof vi.fn> {
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/unlock') && init?.method === 'POST') {
      return new Response('{}', {
        status: overrides.unlock ?? 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (url.includes('/download')) {
      return new Response(new Uint8Array(8), {
        status: overrides.download ?? 200,
        headers: { 'content-type': 'application/octet-stream' },
      })
    }
    if (url.includes('/api/public/shares/')) {
      return new Response(JSON.stringify(META), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response('not found', { status: 404 })
  })
  vi.stubGlobal('fetch', mock)
  return mock
}

function stubBlobDownload(): void {
  Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:fake'), configurable: true })
  Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true })
  HTMLAnchorElement.prototype.click = vi.fn()
}

describe('SharePage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('renders public share metadata', async () => {
    stubFetch()
    const wrapper = mount(SharePage, { props: { token: 'tok' } })
    await flushPromises()

    expect(wrapper.text()).toContain('报告.pdf')
    expect(wrapper.text()).toContain('2.0 KB')
    expect(wrapper.text()).toContain('剩余下载次数')
    expect(wrapper.text()).toContain('3')
  })

  it('downloads the file on click', async () => {
    stubFetch()
    stubBlobDownload()
    const wrapper = mount(SharePage, { props: { token: 'tok' } })
    await flushPromises()

    await wrapper.find('button.download').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('下载已开始')
  })

  it('requires a password when the share is protected', async () => {
    const protectedMeta = { ...META, passwordRequired: true }
    const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/unlock') && init?.method === 'POST') {
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url.includes('/api/public/shares/')) {
        return new Response(JSON.stringify(protectedMeta), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response('not found', { status: 404 })
    })
    vi.stubGlobal('fetch', mock)

    const wrapper = mount(SharePage, { props: { token: 'tok' } })
    await flushPromises()
    expect(wrapper.text()).toContain('此分享受密码保护')

    await wrapper.find('input[type="password"]').setValue('secret')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('button.download').exists()).toBe(true)
    const unlockCall = mock.mock.calls.find((call) => String(call[0]).includes('/unlock'))
    expect(unlockCall).toBeDefined()
    expect(JSON.parse(String(unlockCall?.[1]?.body))).toEqual({ password: 'secret' })
  })

  it('shows an error for an invalid share', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Share not found' } }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )
    const wrapper = mount(SharePage, { props: { token: 'bad' } })
    await flushPromises()

    expect(wrapper.text()).toContain('Share not found')
  })
})
