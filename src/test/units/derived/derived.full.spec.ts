import { describe, expect, it } from 'vitest'
import { full } from '@/domain/derived/strategies/full'
import { createDerivedFixture } from '../../../units/derived/derived.fixtures.ts'

describe('Raph derived full strategy', () => {
  it('recomputes primitive, object and nested mutations synchronously', () => {
    const { kernel, runtime } = createDerivedFixture()
    kernel.set('source', { value: 2, stale: true })
    const handle = runtime.derive({
      from: 'source', to: 'target', strategy: full(),
      compute: (source: any) => ({ result: source?.value ?? 0 }),
    })
    expect(kernel.get('target')).toEqual({ result: 2 })

    kernel.set('source.value', 5)
    expect(kernel.get('target')).toEqual({ result: 5 })
    kernel.merge('source', { value: 7 })
    expect(kernel.get('target')).toEqual({ result: 7 })
    kernel.delete('source.value')
    expect(kernel.get('target')).toEqual({ result: 0 })
    expect(handle.snapshot()).toMatchObject({ computeCount: 4, fullComputeCount: 4, targetWriteCount: 4 })
    runtime.destroy()
  })

  it('supports arrays, aggregates, filter/sort and root reorder', () => {
    const { kernel, runtime } = createDerivedFixture()
    kernel.set('source.rows', [{ id: 2, active: true }, { id: 1, active: false }, { id: 3, active: true }])
    runtime.derive({
      from: 'source.rows', to: 'target.summary', strategy: full(),
      compute: (rows: any[]) => ({
        total: rows.length,
        active: rows.filter(row => row.active).sort((a, b) => a.id - b.id).map(row => row.id),
      }),
    })
    expect(kernel.get('target.summary')).toEqual({ total: 3, active: [2, 3] })
    kernel.set('source.rows', [{ id: 3, active: true }, { id: 2, active: false }])
    expect(kernel.get('target.summary')).toEqual({ total: 2, active: [3] })
    runtime.destroy()
  })

  it('replaces target and removes stale fields', () => {
    const { kernel, runtime } = createDerivedFixture()
    kernel.set('source', { mode: 'long' })
    runtime.derive({
      from: 'source', to: 'target', strategy: full(),
      compute: (source: any) => source.mode === 'long' ? { current: 1, stale: 2 } : { current: 3 },
    })
    kernel.set('source.mode', 'short')
    expect(kernel.get('target')).toEqual({ current: 3 })
    runtime.destroy()
  })

  it('supports null, undefined, manual notify, root delete and ancestor mutation', () => {
    const { kernel, runtime } = createDerivedFixture()
    kernel.set('scope.source', null)
    let calls = 0
    runtime.derive({
      from: 'scope.source', to: 'target.value', strategy: full(),
      compute: (source) => ({ source, calls: ++calls }),
    })
    expect(kernel.get('target.value')).toEqual({ source: null, calls: 1 })
    kernel.notify('scope.source')
    expect(kernel.get('target.value')).toEqual({ source: null, calls: 2 })
    kernel.set('scope', { source: undefined })
    expect(kernel.get('target.value')).toEqual({ source: undefined, calls: 3 })
    kernel.delete('scope')
    expect(kernel.get('target.value')).toEqual({ source: undefined, calls: 4 })
    runtime.destroy()
  })
})
