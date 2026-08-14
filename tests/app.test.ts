import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import App from '../src/App.vue'

function stubMe(status: number): void {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status })))
}

describe('App', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the service foundation', () => {
    const wrapper = mount(App)

    expect(wrapper.get('h1').text()).toBe('Drop')
    expect(wrapper.text()).toContain('Private R2')
  })

  it('shows the sign-in link when unauthenticated', async () => {
    stubMe(401)
    const wrapper = mount(App)
    await flushPromises()

    expect(wrapper.get('a[href="/api/auth/github"]').text()).toBe('Sign in with GitHub')
  })

  it('shows the owner state when authenticated', async () => {
    stubMe(200)
    const wrapper = mount(App)
    await flushPromises()

    expect(wrapper.text()).toContain('Signed in as owner')
  })
})
