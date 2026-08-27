import { describe, expect, it, vi } from 'vitest'
import { collectionByKey } from '@/domain/derived/strategies/collection-by-key'
import { RaphDerivedStrategyError } from '@/domain/types/derived.types'
import { createDerivedFixture, projectRows } from '../../../units/derived/derived.fixtures.ts'

describe('raph derived collectionByKey strategy', () => {
  it.each([
    { name: 'undefined output', emptyOutput: undefined },
    { name: 'empty array output', emptyOutput: [] },
  ])('waits for an initially unavailable collection with $name', ({ emptyOutput }) => {
    const { kernel, runtime } = createDerivedFixture()
    const compute = vi.fn((rows: any[] | undefined) => rows
      ? rows.map(row => ({ id: row.id, label: row.name }))
      : emptyOutput)
    const handle = runtime.derive({
      from: 'source.rows',
      to: 'target.rows',
      strategy: collectionByKey('id'),
      compute,
    })

    expect(kernel.get('target.rows')).toEqual(emptyOutput)
    expect(handle.snapshot()).toMatchObject({ status: 'active', fullComputeCount: 1 })

    kernel.set('source.rows', [{ id: 1, name: 'A' }])

    expect(kernel.get('target.rows')).toEqual([{ id: 1, label: 'A' }])
    expect(handle.snapshot()).toMatchObject({ status: 'active', fullComputeCount: 2 })
    runtime.destroy()
  })

  it('batches updates by key and processes merge/add/delete incrementally', () => {
    const { kernel, runtime } = createDerivedFixture()
    kernel.set('source.rows', [
      { id: 1, name: 'A', value: 1 },
      { id: 2, name: 'B', value: 2 },
      { id: 3, name: 'C', value: 3 },
    ])
    const compute = vi.fn(projectRows)
    const handle = runtime.derive({
      from: 'source.rows',
      to: 'target.rows',
      strategy: collectionByKey('id'),
      compute,
    })

    kernel.transaction(() => {
      kernel.set('source.rows[id=2].value', 20)
      kernel.set('source.rows[id=2].name', 'BB')
      kernel.merge('source.rows[id=1]', { value: 10 })
    })
    expect(compute).toHaveBeenCalledTimes(2)
    expect(compute.mock.calls[1][0]).toEqual([
      { id: 1, name: 'A', value: 10 },
      { id: 2, name: 'BB', value: 20 },
    ])
    expect(kernel.get('target.rows')).toEqual([
      { id: 1, label: 'A:10' },
      { id: 2, label: 'BB:20' },
      { id: 3, label: 'C:3' },
    ])

    kernel.set('source.rows[id=4]', { id: 4, name: 'D', value: 4 })
    expect(kernel.get('target.rows[id=4]')).toEqual({ id: 4, label: 'D:4' })
    kernel.delete('source.rows[id=1]')
    expect(kernel.get('target.rows[id=1]')).toBeUndefined()
    expect(handle.snapshot()).toMatchObject({ incrementalComputeCount: 2, fullComputeCount: 1 })
    runtime.destroy()
  })

  it('recomputes an item after field deletion and falls back to full for key/index/root changes', () => {
    const { kernel, runtime } = createDerivedFixture()
    kernel.set('source.rows', [{ id: 1, name: 'A', value: 1 }, { id: 2, name: 'B', value: 2 }])
    const compute = vi.fn(projectRows)
    runtime.derive({ from: 'source.rows', to: 'target.rows', strategy: collectionByKey('id'), compute })

    kernel.delete('source.rows[id=1].name')
    expect(kernel.get('target.rows[id=1]')).toEqual({ id: 1, label: ':1' })
    kernel.set('source.rows[1].value', 22)
    expect(compute.mock.calls.at(-1)?.[0]).toHaveLength(2)
    kernel.set('source.rows', [{ id: 2, name: 'B', value: 22 }, { id: 1, value: 1 }])
    expect(kernel.get('target.rows')).toEqual([{ id: 2, label: 'B:22' }, { id: 1, label: ':1' }])
    runtime.destroy()
  })

  it('validates cardinality, key uniqueness and order without partial commits', () => {
    const { kernel, runtime } = createDerivedFixture()
    kernel.set('source.rows', [{ id: 1 }, { id: 2 }])
    expect(() => runtime.derive({
      from: 'source.rows',
      to: 'target.bad',
      strategy: collectionByKey('id'),
      compute: (rows: any[]) => rows.slice(0, 1),
    })).toThrow(RaphDerivedStrategyError)
    expect(kernel.get('target.bad')).toBeUndefined()

    expect(() => runtime.derive({
      from: 'source.rows',
      to: 'target.reordered',
      strategy: collectionByKey('id'),
      compute: (rows: any[]) => [...rows].reverse(),
    })).toThrow(RaphDerivedStrategyError)

    kernel.set('source.duplicates', [{ id: 1 }, { id: 1 }])
    expect(() => runtime.derive({
      from: 'source.duplicates',
      to: 'target.duplicates',
      strategy: collectionByKey('id'),
      compute: (rows: any[]) => rows,
    })).toThrow(RaphDerivedStrategyError)
    runtime.destroy()
  })

  it('preserves source order across add/delete and batches a compute failure atomically', () => {
    const { kernel, runtime } = createDerivedFixture()
    kernel.set('source.rows', [{ id: 1, value: 1 }, { id: 2, value: 2 }])
    let fail = false
    runtime.derive({
      from: 'source.rows',
      to: 'target.rows',
      strategy: collectionByKey('id'),
      compute: (rows: any[]) => {
        if (fail) {
          throw new Error('batch failed')
        }
        return rows.map(row => ({ id: row.id, value: row.value * 10 }))
      },
    })
    kernel.set('source.rows[id=3]', { id: 3, value: 3 })
    expect(kernel.get('target.rows')).toEqual([{ id: 1, value: 10 }, { id: 2, value: 20 }, { id: 3, value: 30 }])
    kernel.delete('source.rows[id=2]')
    expect(kernel.get('target.rows')).toEqual([{ id: 1, value: 10 }, , { id: 3, value: 30 }])

    fail = true
    expect(() => kernel.transaction(() => {
      kernel.set('source.rows[id=1].value', 10)
      kernel.set('source.rows[id=3].value', 30)
    })).toThrow('batch failed')
    expect(kernel.get('target.rows')).toEqual([{ id: 1, value: 10 }, , { id: 3, value: 30 }])
    fail = false
    kernel.set('source.rows[id=1].value', 11)
    expect(kernel.get('target.rows')).toEqual([{ id: 1, value: 110 }, , { id: 3, value: 300 }])
    runtime.destroy()
  })

  it('uses a full first computation when immediate is false', () => {
    const { kernel, runtime } = createDerivedFixture()
    kernel.set('source.rows', [{ id: 1, value: 1 }])
    const compute = vi.fn((rows: any[]) => rows.map(row => ({ id: row.id, value: row.value * 2 })))
    const handle = runtime.derive({
      from: 'source.rows',
      to: 'target.rows',
      strategy: collectionByKey('id'),
      immediate: false,
      compute,
    })
    kernel.set('source.rows[id=1].value', 2)
    expect(kernel.get('target.rows')).toEqual([{ id: 1, value: 4 }])
    expect(handle.snapshot()).toMatchObject({ fullComputeCount: 1, incrementalComputeCount: 0 })
    runtime.destroy()
  })

  it.each([
    { name: 'non-array output', compute: () => ({}) },
    { name: 'non-object item', compute: () => [1, 2] },
    { name: 'missing key', compute: () => [{}, {}] },
    { name: 'duplicate output key', compute: () => [{ id: 1 }, { id: 1 }] },
  ])('rejects $name', ({ compute }) => {
    const { kernel, runtime } = createDerivedFixture()
    kernel.set('source.rows', [{ id: 1 }, { id: 2 }])
    expect(() => runtime.derive({
      from: 'source.rows',
      to: 'target.rows',
      strategy: collectionByKey('id'),
      compute: compute as any,
    })).toThrow(RaphDerivedStrategyError)
    expect(kernel.get('target.rows')).toBeUndefined()
    runtime.destroy()
  })

  it.each([
    { name: 'non-array incremental result', next: () => ({}) },
    { name: 'wrong incremental cardinality', next: () => [] },
    { name: 'wrong incremental key order', next: () => [{ id: 2 }] },
  ])('keeps last-good target for $name', ({ next }) => {
    const { kernel, runtime } = createDerivedFixture()
    kernel.set('source.rows', [{ id: 1, value: 1 }])
    let invalid = false
    runtime.derive({
      from: 'source.rows',
      to: 'target.rows',
      strategy: collectionByKey('id'),
      compute: (rows: any[]) => invalid ? next() : rows.map(row => ({ id: row.id, value: row.value })),
    })
    invalid = true
    expect(() => kernel.set('source.rows[id=1].value', 2)).toThrow(RaphDerivedStrategyError)
    expect(kernel.get('target.rows')).toEqual([{ id: 1, value: 1 }])
    runtime.destroy()
  })
})
