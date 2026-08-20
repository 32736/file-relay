import { describe, expect, it } from 'vitest'

import { buildPaginationItems } from '../../src/lib/pagination'

describe('desktop pagination items', () => {
  it('shows every page when the list is short', () => {
    expect(buildPaginationItems(2, 4)).toEqual([1, 2, 3, 4])
  })

  it('keeps the first and last page visible with compact gaps', () => {
    expect(buildPaginationItems(1, 12)).toEqual([1, 2, 3, 4, 5, 'ellipsis', 12])
    expect(buildPaginationItems(6, 12)).toEqual([1, 'ellipsis', 5, 6, 7, 'ellipsis', 12])
    expect(buildPaginationItems(12, 12)).toEqual([1, 'ellipsis', 8, 9, 10, 11, 12])
  })
})
