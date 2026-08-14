import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import IncomingUpload from '../../src/components/IncomingUpload.vue'

const META = {
  title: '给我文件',
  expiresAt: 2000000000,
  maxFiles: 3,
  maxFileSize: 5 * 1024 * 1024,
  uploadedCount: 0,
  siteKey: 'test-site',
}

function stubFetch(): ReturnType<typeof vi.fn> {
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (url.includes('/api/public/incoming/test-token/uploads') && method === 'POST') {
      return new Response(
        JSON.stringify({ uploadId: 'up-1', mode: 'single', chunkSize: 1, totalParts: 1, uploadToken: 'tok-1' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }
    if (url.includes('/api/public/uploads/up-1/content')) {
      return new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (url.includes('/api/public/uploads/up-1/complete')) {
      return new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (url.includes('/api/public/incoming/test-token')) {
      return new Response(JSON.stringify(META), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return new Response('not found', { status: 404 })
  })
  vi.stubGlobal('fetch', mock)
  return mock
}

describe('IncomingUpload', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('renders the request metadata', async () => {
    stubFetch()
    const wrapper = mount(IncomingUpload, { props: { token: 'test-token' } })
    await flushPromises()

    expect(wrapper.text()).toContain('给我文件')
    expect(wrapper.text()).toContain('3 个文件')
    expect(wrapper.text()).toContain('5.0 MB')
  })

  it('uploads through the bearer flow when a Turnstile token exists', async () => {
    const fetchMock = stubFetch()
    // Simulate a resolved Turnstile widget.
    ;(window as unknown as { turnstile?: { render: unknown } }).turnstile = {
      render: vi.fn(() => {
        return 'widget-1'
      }),
    }
    const wrapper = mount(IncomingUpload, { props: { token: 'test-token' } })
    await flushPromises()

    // Set a turnstile token directly and pick a file.
    ;(wrapper.vm as unknown as { turnstileToken: string }).turnstileToken = 'turnstile-ok'
    const file = new File([new Uint8Array(512)], 'photo.png', { type: 'image/png' })
    const input = wrapper.find('input[type="file"]').element as HTMLInputElement
    Object.defineProperty(input, 'files', {
      value: [file] as unknown as FileList,
      configurable: true,
    })
    await wrapper.find('input[type="file"]').trigger('change')
    await wrapper.find('button').trigger('click')
    await flushPromises()

    const calls = fetchMock.mock.calls.map((call) => String(call[0]))
    expect(calls.some((url) => url.includes('/uploads') && !url.includes('/content') && !url.includes('/complete'))).toBe(true)
    expect(calls.some((url) => url.includes('/content'))).toBe(true)
    expect(calls.some((url) => url.includes('/complete'))).toBe(true)
    expect(wrapper.text()).toContain('上传完成')
  })
})
