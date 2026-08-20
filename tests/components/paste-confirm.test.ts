import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import PasteConfirmDialog from '../../src/components/PasteConfirmDialog.vue'

describe('PasteConfirmDialog', () => {
  it('requires an explicit confirmation before emitting upload', async () => {
    const file = new File([new Uint8Array(16)], 'pasted.txt', { type: 'text/plain' })
    const wrapper = mount(PasteConfirmDialog, {
      props: { files: [file] },
      attachTo: document.body,
    })
    await flushPromises()

    expect(document.body.textContent).toContain('确认上传剪贴板文件')
    expect(wrapper.emitted('confirm')).toBeUndefined()

    const confirmButton = document.body.querySelector('button.btn-primary')
    expect(confirmButton).not.toBeNull()
    confirmButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
    expect(wrapper.emitted('confirm')).toHaveLength(1)
    wrapper.unmount()
  })

  it('cancels without emitting upload', async () => {
    const file = new File([new Uint8Array(16)], 'cancel.txt', { type: 'text/plain' })
    const wrapper = mount(PasteConfirmDialog, {
      props: { files: [file] },
      attachTo: document.body,
    })
    await flushPromises()

    const cancelButton = document.body.querySelector('button.ghost')
    expect(cancelButton).not.toBeNull()
    cancelButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
    expect(wrapper.emitted('cancel')).toHaveLength(1)
    expect(wrapper.emitted('confirm')).toBeUndefined()
    wrapper.unmount()
  })
})
