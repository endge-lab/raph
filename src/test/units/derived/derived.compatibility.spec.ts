import { describe, expect, it } from 'vitest'
import type { PhaseExecutorContext, PhaseName } from '@/domain/types/phase.types'
import { RaphNode } from '@/domain/core/RaphNode'
import { createDerivedFixture } from '../../../units/derived/derived.fixtures.ts'

describe('Raph derived compatibility fast path', () => {
  it('preserves CRUD and transaction delivery when no derives are registered', () => {
    const { kernel, runtime } = createDerivedFixture()
    const node = new RaphNode(runtime, { id: 'observer' })
    runtime.addNode(node)
    const events: string[][] = []
    runtime.definePhases([{
      name: 'observe' as PhaseName,
      routes: [], traversal: 'dirty-only',
      each: (ctx: PhaseExecutorContext) => events.push((ctx.events ?? []).map(event => event.canonical)),
    }])
    runtime.observeData(node, 'data.*', { phase: 'observe' })

    kernel.transaction(() => {
      kernel.set('data.object', { a: 1 })
      kernel.merge('data.object', { b: 2 })
      kernel.delete('data.object.a')
    })
    expect(kernel.get('data.object')).toEqual({ b: 2 })
    expect(events).toEqual([['data.object', 'data.object', 'data.object.a']])
    expect(kernel.getDerivedSnapshot()).toMatchObject({ registrations: 0, graphNodes: 0 })
    runtime.destroy()
  })
})
