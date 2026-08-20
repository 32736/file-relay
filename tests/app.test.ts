import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App.vue'

function stubMe(
  status: number,
  magicLinkStatus = 204,
  auditBody: { entries: unknown[]; nextCursor: string | null } = { entries: [], nextCursor: null },
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/auth/me')) {
        return new Response('{}', { status })
      }
      if (url.includes('/api/stats')) {
        return new Response(JSON.stringify({
          fileCount: 3,
          totalBytes: 102400,
          quotaBytes: 10 * 1024 * 1024 * 1024,
          usedRatio: 102400 / (10 * 1024 * 1024 * 1024),
        }), {
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
      if (url.includes('/api/audit')) {
        return new Response(JSON.stringify(auditBody), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      if (url.includes('/api/auth/logout')) {
        return new Response(null, { status: 204 })
      }
      if (url.includes('/api/auth/magic-link')) {
        return new Response(null, { status: magicLinkStatus })
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

    expect(wrapper.get('a.skip-link').attributes('href')).toBe('#main-content')
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

  it('associates Magic Link errors with the email field and restores focus', async () => {
    stubMe(401, 503)
    const wrapper = mount(App, { attachTo: document.body })
    await flushPromises()

    const email = wrapper.get('#magic-link-email')
    await email.setValue('owner@example.test')
    await wrapper.get('form.magic-link-form').trigger('submit')
    await flushPromises()

    expect(email.attributes('aria-invalid')).toBe('true')
    expect(email.attributes('aria-describedby')).toBe('magic-link-error')
    expect(document.activeElement).toBe(email.element)
    wrapper.unmount()
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

    expect(wrapper.text()).toContain('共3项')
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
    const wrapper = mount(App, { attachTo: document.body })
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
    const signInLink = wrapper.get('a[href="/api/auth/github"]')
    expect(signInLink.text()).toBe('使用 GitHub 登录')
    expect(document.activeElement).toBe(signInLink.element)
    wrapper.unmount()
  })

  it('does not block Escape when no desktop management dialog is open', async () => {
    stubMe(200)
    const wrapper = mount(App)
    await flushPromises()

    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    })
    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
    wrapper.unmount()
  })

  it('renders share management in the desktop workspace without a header shortcut', async () => {
    stubMe(200)
    const wrapper = mount(App)
    await flushPromises()

    expect(wrapper.find('#shares-panel').exists()).toBe(true)
    expect(
      wrapper
        .findAll('.topbar-actions .action-label')
        .filter((label) => label.text() === '分享管理'),
    ).toHaveLength(0)
  })

  it('shows operation records in the visible desktop dialog', async () => {
    stubMe(200, 204, {
      entries: [
        {
          id: 'audit-1',
          action: 'file.uploaded',
          targetType: 'file',
          targetId: 'file-1',
          metadata: { size: 2048 },
          createdAt: 1700000000,
        },
      ],
      nextCursor: null,
    })
    const wrapper = mount(App, { attachTo: document.body })
    await flushPromises()

    const auditButton = wrapper
      .findAll('.topbar-actions .action-btn')
      .find((button) => button.find('.action-label').text() === '操作记录')
    expect(auditButton).toBeDefined()
    await auditButton?.trigger('click')
    await flushPromises()

    const dialog = wrapper.get('#audit-management-dialog')
    expect(dialog.classes()).toContain('is-visible')
    expect(dialog.text()).toContain('上传文件')
    await dialog.get('button[aria-label="关闭操作记录"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('#audit-management-dialog').exists()).toBe(false)
    wrapper.unmount()
  })

  it('does not render share management as a modal dialog', async () => {
    stubMe(200)
    const wrapper = mount(App)
    await flushPromises()

    expect(wrapper.find('#shares-panel').exists()).toBe(true)
    expect(wrapper.find('#shares-panel').element.closest('dialog')).toBeNull()
  })
})
