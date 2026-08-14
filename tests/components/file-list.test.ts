import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import FileList from '../../src/components/FileList.vue'
import FilePreview from '../../src/components/FilePreview.vue'
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

    await wrapper.findAll('button').find((b) => b.text() === '分享')?.trigger('click')
    expect(wrapper.findComponent(ShareDialog).exists()).toBe(true)
  })

  it('offers preview only for whitelisted types and opens the viewer', async () => {
    stubFiles()
    const wrapper = mount(FileList)
    await flushPromises()

    const buttons = wrapper.findAll('button')
    expect(buttons.filter((b) => b.text() === '预览')).toHaveLength(2) // pdf + png
    // text/html never previews
    expect(wrapper.text()).toContain('页面.html')

    await buttons.find((b) => b.text() === '预览')?.trigger('click')
    expect(wrapper.findComponent(FilePreview).exists()).toBe(true)
  })
})

describe('ShareDialog', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
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
              passwordProtected: Boolean(body.password),
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
