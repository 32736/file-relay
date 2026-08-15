import { describe, expect, it } from 'vitest'

import { localizeErrorMessage } from '../../src/lib/api'

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
})
