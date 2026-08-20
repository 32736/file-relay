import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import FileExpirationDialog from '../../src/components/FileExpirationDialog.vue'
import ShareDialog from '../../src/components/ShareDialog.vue'

const file = {
  id: 'f1',
  name: '报告.pdf',
  size: 2048,
  mimeType: 'application/pdf',
  createdAt: 1700000000,
  expiresAt: null,
}

function stubFailure(): void {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(
    JSON.stringify({ error: { code: 'UPSTREAM_ERROR', message: '请求失败' } }),
    { status: 503, headers: { 'content-type': 'application/json' } },
  )))
}

describe('form error accessibility', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('associates share creation errors with the form and focuses the message', async () => {
    stubFailure()
    const wrapper = mount(ShareDialog, {
      props: { file },
      attachTo: document.body,
    })

    await wrapper.get('form').trigger('submit')
    await flushPromises()
    await nextTick()

    const form = wrapper.get('form')
    const error = wrapper.get('#share-dialog-error')
    expect(form.attributes('aria-describedby')).toBe('share-dialog-error')
    expect(error.attributes('tabindex')).toBe('-1')
    expect(document.activeElement).toBe(error.element)

    wrapper.unmount()
  })

  it('marks the expiration field invalid and focuses its error message', async () => {
    stubFailure()
    const wrapper = mount(FileExpirationDialog, {
      props: { file },
      attachTo: document.body,
    })
    await nextTick()

    const form = document.querySelector<HTMLFormElement>('.expiration-form')
    expect(form).not.toBeNull()
    form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flushPromises()
    await nextTick()

    const select = document.querySelector<HTMLSelectElement>('#expiration-select')
    const error = document.querySelector<HTMLElement>('#expiration-error')
    expect(select?.getAttribute('aria-invalid')).toBe('true')
    expect(select?.getAttribute('aria-describedby')).toBe('expiration-error')
    expect(error?.getAttribute('tabindex')).toBe('-1')
    expect(document.activeElement).toBe(error)

    wrapper.unmount()
  })
})
