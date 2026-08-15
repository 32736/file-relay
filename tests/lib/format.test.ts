import { describe, expect, it } from 'vitest'

import { formatDate } from '../../src/lib/format'

describe('formatDate', () => {
  it('formats epoch seconds as YYYY-MM-DD HH:mm:ss', () => {
    const epochSeconds = new Date(2026, 7, 16, 1, 13, 14).getTime() / 1000
    expect(formatDate(epochSeconds)).toBe('2026-08-16 01:13:14')
  })
})
