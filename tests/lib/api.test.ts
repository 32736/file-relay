import { describe, expect, it } from 'vitest'

import { getUserErrorMessage, localizeErrorMessage } from '../../src/lib/api'

describe('localizeErrorMessage', () => {
  it('localizes upload size errors by API code', () => {
    expect(localizeErrorMessage('PAYLOAD_TOO_LARGE', 'File exceeds the maximum allowed size'))
      .toBe('文件超过允许的最大大小')
  })

  it('localizes known English messages when no code mapping is available', () => {
    expect(localizeErrorMessage(undefined, 'Share not found')).toBe('分享不存在或已失效')
  })

  it('localizes the generic HTTP fallback', () => {
    expect(localizeErrorMessage(undefined, 'Request failed (503)')).toBe('请求失败（503）')
  })

  it('keeps UI errors localized and falls back for unknown thrown values', () => {
    expect(getUserErrorMessage(new Error('Failed to fetch'), '备用提示'))
      .toBe('网络连接失败，请稍后重试')
    expect(getUserErrorMessage(new Error('文件不存在'), '备用提示')).toBe('文件不存在')
    expect(getUserErrorMessage({ reason: 'unknown' }, '备用提示')).toBe('备用提示')
  })
})
