import { describe, expect, it, vi } from 'vitest'

import { keyedPath } from '@/domain/derived/derived-path'
import { filterByKey } from '@/domain/derived/strategies/filter-by-key'
import { DataPath } from '@/domain/entities/DataPath'
import { RaphDerivedStrategyError } from '@/domain/types/derived.types'
import { createDerivedFixture } from '../../../units/derived/derived.fixtures.ts'

describe('raph derived filterByKey strategy', () => {
  it('normalizes, freezes and validates the strategy descriptor', () => {
    const strategy = filterByKey('  flightId  ')
    expect(strategy).toEqual({ kind: 'filter-by-key', key: 'flightId' })
    expect(Object.isFrozen(strategy)).toBe(true)
    expect(() => filterByKey('')).toThrow(RaphDerivedStrategyError)
    expect(() => filterByKey('   ')).toThrow(RaphDerivedStrategyError)
    expect(() => filterByKey(null as any)).toThrow(RaphDerivedStrategyError)
  })

  it('recomputes only changed keys and updates filtered membership in source order', () => {
    const { kernel, runtime } = createDerivedFixture()
    kernel.set('source.rows', [
      { id: 1, name: 'Alpha' },
      { id: 2, name: 'Bravo' },
      { id: 3, name: 'Charlie' },
    ])
    const compute = vi.fn((rows: Array<{ id: number, name: string }>) => {
      return rows.filter(row => row.name.toLowerCase().includes('a'))
    })
    const handle = runtime.derive({
      from: 'source.rows',
      to: 'target.rows',
      strategy: filterByKey('id'),
      compute,
    })

    expect(kernel.get('target.rows')).toEqual([
      { id: 1, name: 'Alpha' },
      { id: 2, name: 'Bravo' },
      { id: 3, name: 'Charlie' },
    ])

    kernel.set('source.rows[id=2].name', 'Echo')
    expect(compute.mock.calls.at(-1)?.[0]).toEqual([{ id: 2, name: 'Echo' }])
    expect(kernel.get('target.rows')).toEqual([
      { id: 1, name: 'Alpha' },
      { id: 3, name: 'Charlie' },
    ])

    kernel.set('source.rows[id=2].name', 'Delta')
    expect(kernel.get('target.rows')).toEqual([
      { id: 1, name: 'Alpha' },
      { id: 2, name: 'Delta' },
      { id: 3, name: 'Charlie' },
    ])
    expect(handle.snapshot()).toMatchObject({ fullComputeCount: 1, incrementalComputeCount: 2 })
    runtime.destroy()
  })

  it('supports transformed accepted rows and emits no target write for rejected-to-rejected updates', () => {
    const { kernel, runtime } = createDerivedFixture()
    kernel.set('source.rows', [
      { id: 1, visible: true, value: 10 },
      { id: 2, visible: false, value: 20 },
    ])
    const handle = runtime.derive({
      from: 'source.rows',
      to: 'target.rows',
      strategy: filterByKey('id'),
      compute: (rows: Array<{ id: number, visible: boolean, value: number }>) => rows
        .filter(row => row.visible)
        .map(row => ({ id: row.id, doubled: row.value * 2 })),
    })

    expect(kernel.get('target.rows')).toEqual([{ id: 1, doubled: 20 }])
    kernel.set('source.rows[id=1].value', 11)
    expect(kernel.get('target.rows')).toEqual([{ id: 1, doubled: 22 }])
    const writesAfterAcceptedUpdate = handle.snapshot().targetWriteCount

    kernel.set('source.rows[id=2].value', 21)
    expect(kernel.get('target.rows')).toEqual([{ id: 1, doubled: 22 }])
    expect(handle.snapshot()).toMatchObject({
      incrementalComputeCount: 2,
      targetWriteCount: writesAfterAcceptedUpdate,
    })
    runtime.destroy()
  })

  it('detaches fallback-cloned snapshots with functions, dates, arrays and cycles', () => {
    const { kernel, runtime } = createDerivedFixture()
    const source: any = {
      id: 1,
      visible: true,
      nested: { values: [1, 2], at: new Date('2026-08-17T00:00:00.000Z') },
      format: () => 'row-1',
    }
    source.self = source
    kernel.set('source.rows', [source])
    runtime.derive({
      from: 'source.rows',
      to: 'target.rows',
      strategy: filterByKey('id'),
      compute: (rows: any[]) => rows.filter(row => row.visible),
    })

    const target = (kernel.get('target.rows') as any[])[0]
    expect(target).not.toBe(source)
    expect(target.nested).not.toBe(source.nested)
    expect(target.nested.values).not.toBe(source.nested.values)
    expect(target.nested.at).toEqual(source.nested.at)
    expect(target.nested.at).not.toBe(source.nested.at)
    expect(target.format()).toBe('row-1')
    expect(target.self).toBe(target)
    runtime.destroy()
  })

  it('batches changed keys and handles insert/delete without scanning unaffected rows', () => {
    const { kernel, runtime } = createDerivedFixture()
    kernel.set('source.rows', [{ id: 1, visible: true }, { id: 2, visible: false }])
    const compute = vi.fn((rows: Array<{ id: number, visible: boolean }>) => rows.filter(row => row.visible))
    runtime.derive({ from: 'source.rows', to: 'target.rows', strategy: filterByKey('id'), compute })

    kernel.transaction(() => {
      kernel.set('source.rows[id=1].visible', false)
      kernel.set('source.rows[id=2].visible', true)
    })
    expect(compute.mock.calls.at(-1)?.[0]).toEqual([
      { id: 1, visible: false },
      { id: 2, visible: true },
    ])
    expect(kernel.get('target.rows')).toEqual([{ id: 2, visible: true }])

    kernel.set('source.rows[id=3]', { id: 3, visible: true })
    expect(kernel.get('target.rows')).toEqual([{ id: 2, visible: true }, { id: 3, visible: true }])
    kernel.delete('source.rows[id=2]')
    expect(kernel.get('target.rows')).toEqual([{ id: 3, visible: true }])
    runtime.destroy()
  })

  it('sorts a reverse mutation batch into source order before compute', () => {
    const { kernel, runtime } = createDerivedFixture()
    kernel.set('source.rows', [
      { id: 1, visible: true, value: 1 },
      { id: 2, visible: true, value: 2 },
      { id: 3, visible: true, value: 3 },
    ])
    const compute = vi.fn((rows: Array<{ id: number, visible: boolean, value: number }>) => rows.filter(row => row.visible))
    runtime.derive({ from: 'source.rows', to: 'target.rows', strategy: filterByKey('id'), compute })

    kernel.transaction(() => {
      kernel.set('source.rows[id=3].value', 30)
      kernel.set('source.rows[id=1].value', 10)
    })

    expect(compute).toHaveBeenCalledTimes(2)
    expect(compute.mock.calls[1]?.[0]).toEqual([
      { id: 1, visible: true, value: 10 },
      { id: 3, visible: true, value: 30 },
    ])
    runtime.destroy()
  })

  it('keeps rejected inserts and deletes silent while materializing accepted inserts/deletes', () => {
    const { kernel, runtime } = createDerivedFixture()
    kernel.set('source.rows', [{ id: 1, visible: true }])
    const handle = runtime.derive({
      from: 'source.rows',
      to: 'target.rows',
      strategy: filterByKey('id'),
      compute: (rows: Array<{ id: number, visible: boolean }>) => rows.filter(row => row.visible),
    })
    const initialWrites = handle.snapshot().targetWriteCount

    kernel.set('source.rows[id=2]', { id: 2, visible: false })
    kernel.delete('source.rows[id=2]')
    expect(kernel.get('target.rows')).toEqual([{ id: 1, visible: true }])
    expect(handle.snapshot().targetWriteCount).toBe(initialWrites)

    kernel.set('source.rows[id=3]', { id: 3, visible: true })
    expect(kernel.get('target.rows')).toEqual([{ id: 1, visible: true }, { id: 3, visible: true }])
    kernel.delete('source.rows[id=3]')
    expect(kernel.get('target.rows')).toEqual([{ id: 1, visible: true }])
    expect(handle.snapshot().targetWriteCount).toBe(initialWrites + 2)
    runtime.destroy()
  })

  it('falls back to full recompute for root, index and key-field mutations', () => {
    const { kernel, runtime } = createDerivedFixture()
    kernel.set('source.rows', [{ id: 1, visible: true }, { id: 2, visible: true }])
    const compute = vi.fn((rows: Array<{ id: number, visible: boolean }>) => rows.filter(row => row.visible))
    const handle = runtime.derive({ from: 'source.rows', to: 'target.rows', strategy: filterByKey('id'), compute })

    kernel.set('source.rows[id=2].visible', false)
    expect(compute.mock.calls.at(-1)?.[0]).toHaveLength(1)
    kernel.set('source.rows[0].visible', false)
    expect(compute.mock.calls.at(-1)?.[0]).toHaveLength(2)
    kernel.set('source.rows[id=1].id', 10)
    expect(compute.mock.calls.at(-1)?.[0]).toHaveLength(2)
    kernel.set('source.rows', [{ id: 20, visible: true }])
    expect(compute.mock.calls.at(-1)?.[0]).toHaveLength(1)
    expect(kernel.get('target.rows')).toEqual([{ id: 20, visible: true }])
    expect(handle.snapshot()).toMatchObject({ fullComputeCount: 4, incrementalComputeCount: 1 })
    runtime.destroy()
  })

  it('uses a full first computation when immediate is false', () => {
    const { kernel, runtime } = createDerivedFixture()
    kernel.set('source.rows', [{ id: 1, visible: true }])
    const handle = runtime.derive({
      from: 'source.rows',
      to: 'target.rows',
      strategy: filterByKey('id'),
      immediate: false,
      compute: (rows: Array<{ id: number, visible: boolean }>) => rows.filter(row => row.visible),
    })

    kernel.set('source.rows[id=1].visible', false)
    expect(kernel.get('target.rows')).toEqual([])
    expect(handle.snapshot()).toMatchObject({ fullComputeCount: 1, incrementalComputeCount: 0 })
    runtime.destroy()
  })

  it('recomputes the full collection explicitly when an external predicate changes', () => {
    const { kernel, runtime } = createDerivedFixture()
    kernel.set('source.rows', [{ id: 1, text: 'SU101' }, { id: 2, text: 'S7202' }])
    let search = 'su'
    const handle = runtime.derive({
      from: 'source.rows',
      to: 'target.rows',
      strategy: filterByKey('id'),
      compute: (rows: Array<{ id: number, text: string }>) => rows.filter(row => row.text.toLowerCase().includes(search)),
    })
    expect(kernel.get('target.rows')).toEqual([{ id: 1, text: 'SU101' }])

    search = 's7'
    handle.recompute()
    expect(kernel.get('target.rows')).toEqual([{ id: 2, text: 'S7202' }])
    expect(handle.snapshot()).toMatchObject({ fullComputeCount: 2, incrementalComputeCount: 0 })
    runtime.destroy()
  })

  it('supports escaped string keys on the incremental path', () => {
    const { kernel, runtime } = createDerivedFixture()
    kernel.set('source.rows', [{ id: 'SU "101"', visible: true, value: 1 }])
    runtime.derive({
      from: 'source.rows',
      to: 'target.rows',
      strategy: filterByKey('id'),
      compute: (rows: Array<{ id: string, visible: boolean, value: number }>) => rows.filter(row => row.visible),
    })

    kernel.set(`${keyedPath(DataPath.from('source.rows'), 'id', 'SU "101"')}.visible`, false)
    expect(kernel.get('target.rows')).toEqual([])
    runtime.destroy()
  })

  it('rejects outputs that are not an ordered subset of input', () => {
    const { kernel, runtime } = createDerivedFixture()
    kernel.set('source.rows', [{ id: 1 }, { id: 2 }])

    expect(() => runtime.derive({
      from: 'source.rows',
      to: 'target.rows',
      strategy: filterByKey('id'),
      compute: (rows: Array<{ id: number }>) => [...rows].reverse(),
    })).toThrow(RaphDerivedStrategyError)
    expect(kernel.get('target.rows')).toBeUndefined()
    runtime.destroy()
  })

  it.each([
    { name: 'non-array source', source: { id: 1 }, compute: () => [] },
    { name: 'non-array output', source: [{ id: 1 }], compute: () => ({ id: 1 }) },
    { name: 'source item without key', source: [{}], compute: (rows: unknown[]) => rows },
    { name: 'duplicate source key', source: [{ id: 1 }, { id: 1 }], compute: (rows: unknown[]) => rows },
    { name: 'output item without key', source: [{ id: 1 }], compute: () => [{}] },
    { name: 'duplicate output key', source: [{ id: 1 }, { id: 2 }], compute: () => [{ id: 1 }, { id: 1 }] },
    { name: 'foreign output key', source: [{ id: 1 }], compute: () => [{ id: 2 }] },
  ])('rejects $name without committing a target', ({ source, compute }) => {
    const { kernel, runtime } = createDerivedFixture()
    kernel.set('source.rows', source)
    expect(() => runtime.derive({
      from: 'source.rows',
      to: 'target.rows',
      strategy: filterByKey('id'),
      compute: compute as any,
    })).toThrow(RaphDerivedStrategyError)
    expect(kernel.get('target.rows')).toBeUndefined()
    expect(kernel.getDerivedSnapshot().registrations).toBe(0)
    runtime.destroy()
  })

  it('keeps the last-good target after invalid incremental output and recovers with a full retry', () => {
    const { kernel, runtime } = createDerivedFixture()
    kernel.set('source.rows', [{ id: 1, visible: true, value: 1 }, { id: 2, visible: true, value: 2 }])
    let invalid = false
    const handle = runtime.derive({
      from: 'source.rows',
      to: 'target.rows',
      strategy: filterByKey('id'),
      compute: (rows: Array<{ id: number, visible: boolean, value: number }>) => invalid
        ? [{ ...rows[0]!, id: 999 }]
        : rows.filter(row => row.visible),
    })
    invalid = true
    expect(() => kernel.set('source.rows[id=1].value', 10)).toThrow(RaphDerivedStrategyError)
    expect(kernel.get('target.rows')).toEqual([
      { id: 1, visible: true, value: 1 },
      { id: 2, visible: true, value: 2 },
    ])
    expect(handle.status).toBe('error')

    invalid = false
    kernel.set('source.rows[id=2].value', 20)
    expect(kernel.get('target.rows')).toEqual([
      { id: 1, visible: true, value: 10 },
      { id: 2, visible: true, value: 20 },
    ])
    expect(handle.snapshot()).toMatchObject({ status: 'active', fullComputeCount: 2, incrementalComputeCount: 1 })
    runtime.destroy()
  })
})
