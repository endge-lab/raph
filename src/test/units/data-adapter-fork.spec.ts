import { describe, expect, it } from 'vitest'
import { DefaultDataAdapter } from '@/domain/entities/data-adapter'

describe('isolated mutation projection', () => {
  it('does not read or copy unrelated rows and reuses a warm source index', () => {
    let reads = 0
    const rows = Array.from({ length: 10000 }, (_, id) => ({ id, value: 0, nested: { get payload() {
      reads++
      return 'payload'
    } } }))
    const adapter = new DefaultDataAdapter({ rows })
    adapter.get('rows[id=5000]')
    for (let index = 0; index < rows.length; index++) {
      if (index === 5000) {
        continue
      }
      const row = rows[index]
      Object.defineProperty(rows, index, { get() {
        reads++
        return row
      }, configurable: true })
    }
    const draft = adapter.fork()
    draft.set('rows[id=5000].value', 7)
    expect(draft.get('rows[id=5000].value')).toBe(7)
    expect(rows[5000].value).toBe(0)
    expect(reads).toBe(0)
  })

  it('isolates replacements, merges, deletions and writes through aliases', () => {
    const shared = { count: 0 }
    const initial = { rows: [{ id: 1, shared }, { id: 2, shared }], untouched: { value: 1 } }
    const adapter = new DefaultDataAdapter(initial)
    const draft = adapter.fork()
    draft.set('rows[id=1].shared.count', 2)
    expect(draft.get('rows[id=2].shared.count')).toBe(2)
    draft.merge('rows[id=1]', { extra: true })
    draft.delete('rows[id=2]')
    draft.set('rows[id=3]', { value: 3 })
    expect(draft.get('rows[id=3]')).toEqual({ id: 3, value: 3 })
    expect(draft.has('rows[id=2]')).toBe(false)
    expect(initial.rows).toEqual([{ id: 1, shared: { count: 0 } }, { id: 2, shared: { count: 0 } }])
    expect(initial.untouched).toEqual({ value: 1 })
  })

  it('invalidates projected selector indexes after changing a key or shifting rows', () => {
    const adapter = new DefaultDataAdapter({ rows: [{ id: 1 }, { id: 2 }] }, { arrayDelete: 'splice', indexStrategy: 'eager-all-keys' })
    adapter.get('rows[id=1]')
    const draft = adapter.fork()
    draft.set('rows[id=1].id', 3)
    expect(draft.has('rows[id=1]')).toBe(false)
    expect(draft.has('rows[id=3]')).toBe(true)
    draft.delete('rows[0]')
    expect(draft.get('rows[id=2]')).toEqual({ id: 2 })
    expect(draft.get('rows')).toEqual([{ id: 2 }])
    expect(adapter.get('rows')).toEqual([{ id: 1 }, { id: 2 }])
  })

  it('preserves sparse arrays, length truncation, cycles and frozen input isolation', () => {
    const row: any = { id: 1, value: 0 }
    row.self = row
    const initial = { rows: [row, undefined, { id: 3 }] }
    delete initial.rows[1]
    Object.freeze(row)
    const draft = new DefaultDataAdapter(initial).fork()
    draft.set('rows[0].self.value', 4)
    expect(draft.get('rows[0].value')).toBe(4)
    expect(row.value).toBe(0)
    expect(draft.has('rows[1]')).toBe(false)
    draft.set('rows.length', 1)
    draft.set('rows.length', 3)
    expect(draft.has('rows[2]')).toBe(false)
    expect(initial.rows).toHaveLength(3)
  })
})
