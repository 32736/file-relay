import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import UploadZone from '../../src/components/UploadZone.vue'

function stubApi(): ReturnType<typeof vi.fn> {
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/api/uploads') && init?.method === 'POST') {
      return new Response(
        JSON.stringify({ uploadId: 'sess-1', mode: 'single', chunkSize: 33554432, totalParts: 1 }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }
    if (url.includes('/content') && init?.method === 'PUT') {
      return new Response(JSON.stringify({ id: 'file-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (url.includes('/complete') && init?.method === 'POST') {
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return new Response('not found', { status: 404 })
  })
  vi.stubGlobal('fetch', mock)
  return mock
}

describe('UploadZone', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
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
    expect(calls).toContainEqual(['/api/uploads/sess-1/content', 'PUT'])
    expect(calls).toContainEqual(['/api/uploads/sess-1/complete', 'POST'])
    expect(wrapper.emitted('uploaded')).toHaveLength(1)
  })
})
