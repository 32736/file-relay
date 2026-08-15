import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import App from '../src/App.vue'

function stubMe(status: number): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/auth/me')) {
        return new Response('{}', { status })
      }
      if (url.includes('/api/stats')) {
        return new Response(JSON.stringify({ fileCount: 3, totalBytes: 102400 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      if (url.includes('/api/files')) {
        return new Response(JSON.stringify({ files: [], nextCursor: null }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      if (url.includes('/api/shares')) {
        return new Response(JSON.stringify({ shares: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response('not found', { status: 404 })
    }),
  )
}

describe('App', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the service title', () => {
    const wrapper = mount(App)

    expect(wrapper.get('h1').text()).toBe('Drop')
  })

  it('shows the sign-in link when unauthenticated', async () => {
    stubMe(401)
    const wrapper = mount(App)
    await flushPromises()

    expect(wrapper.get('a[href="/api/auth/github"]').text()).toBe('使用 GitHub 登录')
  })

  it('shows the owner workspace, stats, and tab navigation', async () => {
    stubMe(200)
    const wrapper = mount(App)
    await flushPromises()

    expect(wrapper.text()).toContain('3 个文件')
    expect(wrapper.text()).toContain('选择文件上传')
    expect(wrapper.text()).not.toContain('发出一个文件')
    expect(wrapper.text()).not.toContain('我的文件')
    expect(wrapper.text()).not.toContain('拖入任意位置即可上传文件')
    expect(wrapper.text()).toContain('文件')
    expect(wrapper.text()).toContain('分享')
  })

  it('switches to the share management tab', async () => {
    stubMe(200)
    const wrapper = mount(App)
    await flushPromises()

    const buttons = wrapper.findAll('nav.tabs button')
    const shareTab = buttons.find((b) => b.text() === '分享')
    expect(shareTab).toBeDefined()
    await shareTab?.trigger('click')
    await flushPromises()
    await flushPromises()

    expect(wrapper.find('dialog.share-management-dialog').exists()).toBe(true)
  })
})
