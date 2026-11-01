import { describe, expect, it } from 'vitest'
import { domainSources } from './run'

describe('domainSources', () => {
  it('keeps domain sources, drops tests, typings and other folders', () => {
    expect(
      domainSources([
        'src/domain/money.ts',
        'src/domain/sub/split.ts',
        'src/domain/money.test.ts',
        'src/domain/types.d.ts',
        'src/domain/readme.md',
        'src/data/db.ts',
        'src/domainish/x.ts',
        'scripts/domain/x.ts',
      ]),
    ).toEqual(['src/domain/money.ts', 'src/domain/sub/split.ts'])
  })
  it('is empty when there is nothing to mutate', () => {
    expect(domainSources([])).toEqual([])
  })
})
