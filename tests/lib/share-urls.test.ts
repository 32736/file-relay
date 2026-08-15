import { beforeEach, describe, expect, it } from 'vitest'

import { loadShareUrls, saveShareUrl } from '../../src/lib/share-urls'

describe('share-urls local cache', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('saves and loads URLs keyed by share id', () => {
    expect(loadShareUrls()).toEqual({})
    saveShareUrl('s1', 'https://drop.28207.cc/s/ABC123')
    saveShareUrl('s2', 'https://drop.28207.cc/s/DEF456')
    expect(loadShareUrls()).toEqual({
      s1: 'https://drop.28207.cc/s/ABC123',
      s2: 'https://drop.28207.cc/s/DEF456',
    })
  })

  it('overwrites the entry for the same id', () => {
    saveShareUrl('s1', 'https://drop.28207.cc/s/OLD')
    saveShareUrl('s1', 'https://drop.28207.cc/s/NEW')
    expect(loadShareUrls()).toEqual({ s1: 'https://drop.28207.cc/s/NEW' })
  })

  it('tolerates corrupted storage', () => {
    localStorage.setItem('drop-share-urls', '{broken json')
    expect(loadShareUrls()).toEqual({})
  })
})
