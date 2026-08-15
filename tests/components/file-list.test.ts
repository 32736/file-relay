import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import FileList from '../../src/components/FileList.vue'
import ShareDialog from '../../src/components/ShareDialog.vue'

vi.mock('qrcode', () => ({
  default: { toCanvas: vi.fn(async () => undefined) },
}))

function stubFiles(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/files?') || url === '/api/files') {
        return new Response(
          JSON.stringify({
            files: [
              { id: 'f1', name: '报告.pdf', size: 2048, mimeType: 'application/pdf', createdAt: 1700000000 },
              { id: 'f2', name: '照片.png', size: 4096, mimeType: 'image/png', createdAt: 1700000001 },
              { id: 'f3', name: '页面.html', size: 1024, mimeType: 'text/html', createdAt: 1700000002 },
            ],
            nextCursor: null,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response('not found', { status: 404 })
    }),
  )
}

/** Fetch stub with batch-delete / batch-restore recording for undo tests. */
function stubWithDelete(): ReturnType<typeof vi.fn> {
  const calls: { url: string; method?: string }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, method: init?.method })
      if (url.includes('/batch-delete') && init?.method === 'POST') {
        return new Response(JSON.stringify({ deleted: 2 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      if (url.includes('/batch-restore') && init?.method === 'POST') {
        return new Response(JSON.stringify({ restored: 2 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      if (url.includes('/api/files?') || url === '/api/files') {
        return new Response(
          JSON.stringify({
            files: [
              { id: 'f1', name: 'a.txt', size: 10, mimeType: 'text/plain', createdAt: 1 },
              { id: 'f2', name: 'b.txt', size: 20, mimeType: 'text/plain', createdAt: 2 },
            ],
            nextCursor: null,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response('not found', { status: 404 })
    }),
  )
  return vi.mocked(globalThis.fetch)
}

describe('FileList', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the file rows and a share dialog on demand', async () => {
    stubFiles()
    const wrapper = mount(FileList)
    await flushPromises()

    expect(wrapper.text()).toContain('报告.pdf')
    expect(wrapper.text()).toContain('照片.png')
    expect(wrapper.text()).toContain('2.0 KB')

    await wrapper
      .findAll('button')
      .find((b) => b.attributes('aria-label') === '分享')
      ?.trigger('click')
    expect(wrapper.findComponent(ShareDialog).exists()).toBe(true)
  })


  it('confirms batch delete and offers an undo window that restores', async () => {
    stubWithDelete()
    vi.stubGlobal('confirm', vi.fn(() => true))
    const wrapper = mount(FileList)
    await flushPromises()

    // Select two rows via the row checkboxes.
    const checkboxes = wrapper.findAll('input[type="checkbox"]')
    await checkboxes[1].setValue(true)
    await checkboxes[2].setValue(true)
    await wrapper.find('button.danger').trigger('click')
    await flushPromises()

    expect(globalThis.confirm).toHaveBeenCalled()
    expect(wrapper.text()).toContain('已删除 · 撤销')

    await wrapper.find('button:not(.danger)').trigger('click') // the undo button
    await flushPromises()

    const fetchMock = vi.mocked(globalThis.fetch)
    const calls = fetchMock.mock.calls.map((call) => String(call[0]))
    expect(calls.some((url) => url.includes('/batch-delete'))).toBe(true)
    expect(calls.some((url) => url.includes('/batch-restore'))).toBe(true)
  })

  it('marks the select-all checkbox indeterminate on partial selection', async () => {
    stubFiles()
    const wrapper = mount(FileList)
    await flushPromises()

    const checkboxes = wrapper.findAll('input[type="checkbox"]')
    expect(checkboxes[0].element as HTMLInputElement).not.toHaveProperty('indeterminate', true)

    await checkboxes[1].setValue(true)
    await flushPromises()

    const selectAll = wrapper.find('input[type="checkbox"]').element as HTMLInputElement
    expect(selectAll.indeterminate).toBe(true)
  })

  it('creates a share and renders the URL and QR canvas', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.includes('/shares') && init?.method === 'POST') {
          const body = JSON.parse(String(init.body)) as Record<string, unknown>
          return new Response(
            JSON.stringify({
              id: 's1',
              url: 'https://drop.28207.cc/s/ABC123',
              expiresAt: null,
              maxDownloads: body.maxDownloads ?? null,
              deleteFileAfterExhausted: false,
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          )
        }
        return new Response('not found', { status: 404 })
      }),
    )

    const wrapper = mount(ShareDialog, {
      props: {
        file: { id: 'f1', name: 'a.pdf', size: 10, mimeType: 'application/pdf', createdAt: 1 },
      },
    })
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.text()).toContain('分享已创建')
    expect(wrapper.text()).toContain('https://drop.28207.cc/s/ABC123')
    expect(wrapper.find('canvas').exists()).toBe(true)
  })
})
