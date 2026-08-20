import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import UploadZone from '../../src/components/UploadZone.vue'

class MockXhr {
  static instances: MockXhr[] = []
  static failNext = false
  open = vi.fn()
  setRequestHeader = vi.fn()
  send = vi.fn(() => {
    if (MockXhr.failNext) {
      MockXhr.failNext = false
      this.status = 400
      this.responseText = JSON.stringify({ error: { code: 'UPSTREAM_ERROR', message: 'Part upload failed' } })
    } else {
      this.status = 200
    }
    this.onload?.()
  })
  upload: { onprogress: unknown } = { onprogress: null }
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null
  status = 200
  responseText = ''

  constructor() {
    MockXhr.instances.push(this)
  }
}

function stubApi(options: { failFirstCreate?: boolean } = {}): ReturnType<typeof vi.fn> {
  let createCalls = 0
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (url === '/api/uploads' && method === 'POST') {
      createCalls++
      if (options.failFirstCreate && createCalls === 1) {
        return new Response(
          JSON.stringify({ error: { code: 'UPSTREAM_ERROR', message: 'Part upload failed' } }),
          { status: 503, headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response(
        JSON.stringify({ uploadId: 'sess-1', mode: 'single', chunkSize: 33554432, totalParts: 1 }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }
    if (url.includes('/api/uploads/') && method === 'GET') {
      return new Response(
        JSON.stringify({ status: 'created', mode: 'single', chunkSize: 33554432, totalParts: 1, completedParts: [] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }
    if (url.includes('/complete') && method === 'POST') {
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return new Response('not found', { status: 404 })
  })
  vi.stubGlobal('fetch', mock)
  vi.stubGlobal('XMLHttpRequest', MockXhr)
  return mock
}

describe('UploadZone', () => {
  beforeEach(() => {
    MockXhr.instances = []
    MockXhr.failNext = false
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('keeps programmatic file pickers out of the tab order', () => {
    const wrapper = mount(UploadZone)

    expect(wrapper.get('#file-picker').attributes('tabindex')).toBe('-1')
    expect(wrapper.get('#resume-picker').attributes('tabindex')).toBe('-1')
  })

  it('uploads a single-mode file through the API', async () => {
    const fetchMock = stubApi()
    const wrapper = mount(UploadZone)

    const file = new File([new Uint8Array(1024)], 'hello.txt', { type: 'text/plain' })
    const input = wrapper.find('input[type="file"]').element as HTMLInputElement
    Object.defineProperty(input, 'files', {
      value: [file] as unknown as FileList,
      configurable: true,
    })
    await wrapper.find('input[type="file"]').trigger('change')
    await flushPromises()

    const calls = fetchMock.mock.calls.map((call) => [String(call[0]), call[1]?.method])
    expect(calls).toContainEqual(['/api/uploads', 'POST'])
    expect(calls).toContainEqual(['/api/uploads/sess-1/complete', 'POST'])
    expect(wrapper.emitted('uploaded')).toHaveLength(1)
    expect(wrapper.text()).toContain('上传完成')
    expect(MockXhr.instances).toHaveLength(1)
    expect(MockXhr.instances[0].open).toHaveBeenCalledWith('PUT', '/api/uploads/sess-1/content')
  })

  it('shows a progress bar while uploading', async () => {
    stubApi()
    const wrapper = mount(UploadZone)

    const file = new File([new Uint8Array(2048)], 'big.bin', { type: 'application/octet-stream' })
    const input = wrapper.find('input[type="file"]').element as HTMLInputElement
    Object.defineProperty(input, 'files', {
      value: [file] as unknown as FileList,
      configurable: true,
    })
    await wrapper.find('input[type="file"]').trigger('change')
    await flushPromises()

    expect(wrapper.find('.tasks .task').exists()).toBe(true)
    expect(wrapper.find('.bar .fill').exists()).toBe(true)
  })

  it('recreates the upload session when retrying a failed session creation', async () => {
    const fetchMock = stubApi({ failFirstCreate: true })
    const wrapper = mount(UploadZone)
    const file = new File([new Uint8Array(1024)], 'retry.txt', { type: 'text/plain' })
    const input = wrapper.find('input[type="file"]').element as HTMLInputElement
    Object.defineProperty(input, 'files', {
      value: [file] as unknown as FileList,
      configurable: true,
    })

    await wrapper.find('input[type="file"]').trigger('change')
    await flushPromises()
    expect(wrapper.text()).toContain('上传失败')

    await wrapper.find('.task .actions button').trigger('click')
    await flushPromises()

    const calls = fetchMock.mock.calls.map((call) => [String(call[0]), call[1]?.method])
    expect(calls.filter(([url, method]) => url === '/api/uploads' && method === 'POST')).toHaveLength(2)
    expect(calls).toContainEqual(['/api/uploads/sess-1/complete', 'POST'])
    expect(wrapper.text()).toContain('上传完成')
    expect(MockXhr.instances).toHaveLength(1)
  })

  it('retries a failed content upload and starts the transfer again', async () => {
    const fetchMock = stubApi()
    MockXhr.failNext = true
    const wrapper = mount(UploadZone)
    const file = new File([new Uint8Array(1024)], 'content-retry.txt', { type: 'text/plain' })
    const input = wrapper.find('input[type="file"]').element as HTMLInputElement
    Object.defineProperty(input, 'files', {
      value: [file] as unknown as FileList,
      configurable: true,
    })

    await wrapper.find('input[type="file"]').trigger('change')
    await flushPromises()
    expect(wrapper.text()).toContain('上传失败')

    await wrapper.find('.task .actions button').trigger('click')
    await flushPromises()

    const calls = fetchMock.mock.calls.map((call) => [String(call[0]), call[1]?.method])
    expect(calls).toContainEqual(['/api/uploads/sess-1/complete', 'POST'])
    expect(wrapper.text()).toContain('上传完成')
    expect(MockXhr.instances).toHaveLength(2)
  })
})
