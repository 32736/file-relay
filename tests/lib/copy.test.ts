import { describe, expect, it } from 'vitest'

import {
  COPY,
  formatFileCount,
  formatFileRetention,
  getShareStatusLabel,
  getUploadStatusLabel,
} from '../../src/lib/copy'

describe('centralized UI copy', () => {
  it('formats file counts consistently', () => {
    expect(formatFileCount(7)).toBe('共7项')
  })

  it('formats retention states consistently', () => {
    expect(formatFileRetention(null, () => '不会使用')).toBe(COPY.files.permanent)
    expect(formatFileRetention(undefined, () => '不会使用')).toBe(COPY.files.defaultRetention)
    expect(formatFileRetention(1700000000, (value) => String(value))).toBe('到期时间 1700000000')
  })

  it('uses Chinese labels for upload states', () => {
    expect(getUploadStatusLabel('queued', false)).toBe(COPY.upload.queued)
    expect(getUploadStatusLabel('paused', false)).toContain('需重新选择文件')
    expect(getUploadStatusLabel('completed', false)).toBe(COPY.upload.completed)
  })

  it('uses centralized labels for share states', () => {
    expect(getShareStatusLabel({ revokedAt: 1, expiresAt: null, maxDownloads: null, downloadCount: 0 }))
      .toBe(COPY.shares.revoked)
    expect(getShareStatusLabel({ revokedAt: null, expiresAt: 1, maxDownloads: null, downloadCount: 0 }))
      .toBe(COPY.shares.expired)
    expect(getShareStatusLabel({ revokedAt: null, expiresAt: null, maxDownloads: 1, downloadCount: 1 }))
      .toBe(COPY.shares.exhausted)
  })
})
