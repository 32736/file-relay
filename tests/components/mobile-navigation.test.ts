import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import MobileActionSheet from '../../src/components/mobile/MobileActionSheet.vue'
import MobileApp from '../../src/components/mobile/MobileApp.vue'
import MobileShareDetail from '../../src/components/mobile/MobileShareDetail.vue'

const file = {
  id: 'f1',
  name: '报告.pdf',
  size: 2048,
  mimeType: 'application/pdf',
  createdAt: 1700000000,
}

const share = {
  id: 's1',
  fileId: 'f1',
  fileName: '报告.pdf',
  createdAt: 1700000000,
  expiresAt: null,
  maxDownloads: null,
  downloadCount: 0,
  revokedAt: null,
  url: null,
}

function stubMobileFetch(): void {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/api/stats')) {
      return new Response(JSON.stringify({
        fileCount: 1,
        totalBytes: 2048,
        quotaBytes: 10 * 1024 * 1024 * 1024,
        usedRatio: 0,
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (url.includes('/api/files')) {
      return new Response(JSON.stringify({ files: [file], nextCursor: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (url.includes('/api/shares')) {
      return new Response(JSON.stringify({ shares: [share], nextCursor: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response('not found', { status: 404 })
  }))
}

function appendTrigger(): HTMLButtonElement {
  const trigger = document.createElement('button')
  document.body.append(trigger)
  trigger.focus()
  return trigger
}

describe('mobile keyboard navigation', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('moves between mobile tabs in both arrow directions and restores focus', async () => {
    stubMobileFetch()
    const wrapper = mount(MobileApp, { attachTo: document.body })
    await flushPromises()
    await nextTick()

    const filesTab = wrapper.get('#mobile-files-tab')
    const sharesTab = wrapper.get('#mobile-shares-tab')

    filesTab.element.focus()
    await filesTab.trigger('keydown', { key: 'ArrowRight' })
    await nextTick()
    expect(document.activeElement).toBe(sharesTab.element)

    await sharesTab.trigger('keydown', { key: 'ArrowRight' })
    await nextTick()
    expect(document.activeElement).toBe(filesTab.element)

    await filesTab.trigger('keydown', { key: 'End' })
    await nextTick()
    expect(document.activeElement).toBe(sharesTab.element)

    await sharesTab.trigger('keydown', { key: 'Home' })
    await nextTick()
    expect(document.activeElement).toBe(filesTab.element)

    wrapper.unmount()
  })

  it('focuses the share detail back button and restores its opener', async () => {
    const trigger = appendTrigger()
    const wrapper = mount(MobileShareDetail, { props: { share }, attachTo: document.body })
    await flushPromises()
    await nextTick()

    const backButton = wrapper.get('button.back-btn').element
    expect(document.activeElement).toBe(backButton)

    wrapper.unmount()
    await flushPromises()
    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })

  it('restores the row trigger before handing off from the action sheet', async () => {
    const trigger = appendTrigger()
    const wrapper = mount(MobileActionSheet, { props: { file }, attachTo: document.body })
    await flushPromises()
    await nextTick()

    const actionButton = document.querySelector<HTMLButtonElement>('button.action-row')
    expect(actionButton).not.toBeNull()
    actionButton?.click()
    await nextTick()

    expect(document.activeElement).toBe(trigger)
    expect(wrapper.emitted('share')).toHaveLength(1)

    wrapper.unmount()
    trigger.remove()
  })
})
