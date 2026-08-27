import type { PhaseExecutorContext, PhaseName } from '@/domain/types/phase.types'
import { describe, expect, it, vi } from 'vitest'
import { RaphNode } from '@/domain/core/RaphNode'
import { createDerivedFixture } from '../../../units/derived/derived.fixtures.ts'

describe('raph derived transactions', () => {
  it('coalesces nested transactions and delivers source/target after stabilization', () => {
    const { kernel, runtime } = createDerivedFixture()
    kernel.set('source', { value: 1 })
    const compute = vi.fn((source: any) => source.value * 2)
    runtime.derive({ from: 'source', to: 'target', compute })

    const observer = new RaphNode(runtime, { id: 'observer' })
    runtime.addNode(observer)
    const batches: string[][] = []
    runtime.definePhases([{
      name: 'observe' as PhaseName,
      routes: [],
      traversal: 'dirty-only',
      each: (ctx: PhaseExecutorContext) => batches.push((ctx.events ?? []).map(event => event.canonical)),
    }])
    runtime.observeData(observer, '*', { phase: 'observe' })

    runtime.transaction(() => {
      runtime.set('source.value', 2)
      runtime.transaction(() => runtime.set('source.value', 3))
    })
    expect(compute).toHaveBeenCalledTimes(2)
    expect(kernel.get('target')).toBe(6)
    expect(batches.at(-1)).toEqual(['source.value', 'source.value', 'target'])
    runtime.destroy()
  })

  it('aggregates callback and derived failures', () => {
    const { kernel, runtime } = createDerivedFixture()
    kernel.set('source', 1)
    runtime.derive({
      from: 'source',
      to: 'target',
      compute: (value) => {
        if (value === 2) {
          throw new Error('compute failed')
        }
        return value
      },
    })
    expect(() => runtime.transaction(() => {
      runtime.set('source', 2)
      throw new Error('callback failed')
    })).toThrow(AggregateError)
    expect(kernel.get('source')).toBe(2)
    expect(kernel.get('target')).toBe(1)
    runtime.destroy()
  })
})
