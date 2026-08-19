import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import App from '../src/App.vue'

function stubMe(status: number): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
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
      if (url.includes('/api/auth/logout')) {
        return new Response(null, { status: 204 })
      }
      if (url.includes('/api/auth/magic-link')) {
        return new Response(null, { status: 204 })
      }
      return new Response('not found', { status: 404 })
    })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
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

  it('requests a Magic Link using the GitHub-bound email form', async () => {
    const fetchMock = stubMe(401)
    const wrapper = mount(App)
    await flushPromises()

    await wrapper.get('#magic-link-email').setValue('owner@example.test')
    await wrapper.get('form.magic-link-form').trigger('submit')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/magic-link',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Origin: window.location.origin }),
        body: JSON.stringify({ email: 'owner@example.test' }),
      }),
    )
    expect(wrapper.text()).toContain('如果该邮箱与 GitHub 已验证主邮箱一致，登录链接已发送。')
  })

  it('does not offer sign-in actions when the service cannot be reached', async () => {
    stubMe(503)
    const wrapper = mount(App)
    await flushPromises()

    expect(wrapper.text()).toContain('无法连接服务，请检查网络后刷新页面再登录。')
    expect(wrapper.find('a[href="/api/auth/github"]').exists()).toBe(false)
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
    expect(wrapper.text()).toContain('退出登录')
  })

  it('logs out through the authenticated API and returns to GitHub login', async () => {
    const fetchMock = stubMe(200)
    const wrapper = mount(App)
    await flushPromises()

    const logoutButton = wrapper
      .findAll('.topbar-actions .action-btn')
      .find((button) => button.find('.action-label').text() === '退出登录')
    expect(logoutButton).toBeDefined()
    await logoutButton?.trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/logout',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Origin: window.location.origin }),
      }),
    )
    expect(wrapper.get('a[href="/api/auth/github"]').text()).toBe('使用 GitHub 登录')
  })

  it('switches to the share management tab', async () => {
    stubMe(200)
    const wrapper = mount(App)
    await flushPromises()

    const shareButton = wrapper
      .findAll('.topbar-actions .action-btn')
      .find((button) => button.find('.action-label').text() === '分享管理')
    expect(shareButton).toBeDefined()
    await shareButton?.trigger('click')
    await flushPromises()
    await flushPromises()

    expect(wrapper.find('dialog.share-management-dialog').exists()).toBe(true)
  })

  it('closes the share management dialog when Escape is pressed', async () => {
    stubMe(200)
    const wrapper = mount(App)
    await flushPromises()

    const shareButton = wrapper
      .findAll('.topbar-actions .action-btn')
      .find((button) => button.find('.action-label').text() === '分享管理')
    await shareButton?.trigger('click')
    await flushPromises()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 200))

    expect(wrapper.find('dialog.share-management-dialog').exists()).toBe(false)
  })
})
