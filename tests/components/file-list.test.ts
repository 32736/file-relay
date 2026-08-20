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
    expect(wrapper.get('.pagination-page[aria-current="page"]').text()).toBe('1')

    await wrapper
      .findAll('button')
      .find((b) => b.attributes('aria-label') === '分享')
      ?.trigger('click')
    await flushPromises()
    expect(wrapper.find('dialog.dialog').exists()).toBe(true)
  })

  it('paginates file rows with ten items per page', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname !== '/api/files') return new Response('not found', { status: 404 })
      const cursor = url.searchParams.get('cursor')
      const files = cursor
        ? [{ id: 'f11', name: '第十一项.txt', size: 10, mimeType: 'text/plain', createdAt: 11 }]
        : Array.from({ length: 10 }, (_, index) => ({
            id: `f${index + 1}`,
            name: `第${index + 1}项.txt`,
            size: 10,
            mimeType: 'text/plain',
            createdAt: index + 1,
          }))
      return new Response(JSON.stringify({ files, nextCursor: cursor ? null : '10' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(FileList)
    await flushPromises()

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('limit=10')
    expect(wrapper.findAll('tbody tr')).toHaveLength(10)
    expect(wrapper.get('.pagination-page[aria-current="page"]').text()).toBe('1')

    await wrapper.get('select[aria-label="文件列表每页条数"]').setValue('20')
    await flushPromises()
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain('limit=20')

    await wrapper.get('.pagination button[aria-label="下一页"]').trigger('click')
    await flushPromises()
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain('cursor=10')
    expect(wrapper.text()).toContain('第十一项.txt')
    expect(wrapper.get('.pagination-page[aria-current="page"]').text()).toBe('2')

    await wrapper.get('.pagination button[aria-label="上一页"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('第1项.txt')
    expect(wrapper.get('.pagination-page[aria-current="page"]').text()).toBe('1')
  })


  it('confirms batch delete and offers an undo window that restores', async () => {
    stubWithDelete()
    const wrapper = mount(FileList)
    await flushPromises()

    // Select two rows via the right-side selection buttons.
    const selectButtons = wrapper.findAll('button.select-btn')
    await selectButtons[0].trigger('click')
    await selectButtons[1].trigger('click')
    await wrapper.find('button.danger').trigger('click')
    await flushPromises()

    // Custom confirm dialog appears; confirm it.
    expect(wrapper.find('.confirm-dialog').exists()).toBe(true)
    await wrapper.find('.btn-danger').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('已删除 2 个文件 · 撤销')

    await wrapper.find('button:not(.danger)').trigger('click') // the undo button
    await flushPromises()

    const fetchMock = vi.mocked(globalThis.fetch)
    const calls = fetchMock.mock.calls.map((call) => String(call[0]))
    expect(calls.some((url) => url.includes('/batch-delete'))).toBe(true)
    expect(calls.some((url) => url.includes('/batch-restore'))).toBe(true)
  })

  it('marks selected rows and selection buttons', async () => {
    stubFiles()
    const wrapper = mount(FileList)
    await flushPromises()

    const selectButton = wrapper.find('button.select-btn')
    await selectButton.trigger('click')
    await flushPromises()

    expect(wrapper.find('tbody tr').classes()).toContain('selected')
    expect(selectButton.attributes('aria-pressed')).toBe('true')
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
    expect(wrapper.text()).toContain('下载 1 次后链接失效，文件将自动清理')
    expect(wrapper.text()).not.toContain('阅后即焚')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.text()).toContain('复制链接')
    expect(wrapper.text()).toContain('https://drop.28207.cc/s/ABC123')
    expect(wrapper.find('canvas').exists()).toBe(true)
  })
})
