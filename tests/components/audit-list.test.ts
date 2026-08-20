import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import AuditList from '../../src/components/AuditList.vue'

function entry(id: string, index: number) {
  return {
    id,
    action: 'file.uploaded',
    targetType: 'file',
    targetId: `file-${index}`,
    metadata: { size: 1024 },
    createdAt: 1700000000 + index,
  }
}

describe('AuditList', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders a paginated table and changes the page size', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost')
      const cursor = url.searchParams.get('cursor')
      const entries = cursor ? [entry('audit-11', 11)] : Array.from({ length: 10 }, (_, index) => entry(`audit-${index + 1}`, index + 1))
      return new Response(JSON.stringify({ entries, nextCursor: cursor ? null : '10' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(AuditList)
    await flushPromises()

    expect(wrapper.find('table').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('仅保留必要操作信息')
    expect(wrapper.findAll('tbody tr')).toHaveLength(10)
    expect((wrapper.get('select[aria-label="操作记录每页条数"]').element as HTMLSelectElement).value).toBe('10')

    await wrapper.get('.pagination button[aria-label="下一页"]').trigger('click')
    await flushPromises()
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain('cursor=10')

    await wrapper.get('select[aria-label="操作记录每页条数"]').setValue('20')
    await flushPromises()
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain('limit=20')
    expect((wrapper.get('select[aria-label="操作记录每页条数"]').element as HTMLSelectElement).value).toBe('20')
    expect(wrapper.text()).toContain('上传文件')
  })
})
