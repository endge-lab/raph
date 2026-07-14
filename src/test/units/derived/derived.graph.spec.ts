import { describe, expect, it } from 'vitest'
import { RaphDerivedCycleError, RaphDerivedTargetWriteError } from '@/domain/types/derived.types'
import { createDerivedFixture } from '../../../units/derived/derived.fixtures.ts'

describe('Raph derived graph', () => {
  it('stabilizes chains and fan-out before returning from source mutation', () => {
    const { kernel, runtime } = createDerivedFixture()
    kernel.set('a', 1)
    runtime.derive({ id: 'a-b', from: 'a', to: 'b', compute: value => Number(value) + 1 })
    runtime.derive({ id: 'b-c', from: 'b', to: 'c', compute: value => Number(value) * 2 })
    runtime.derive({ id: 'a-d', from: 'a', to: 'd', compute: value => Number(value) * 10 })

    kernel.set('a', 3)
    expect(kernel.get('b')).toBe(4)
    expect(kernel.get('c')).toBe(8)
    expect(kernel.get('d')).toBe(30)
    expect(kernel.getDerivedSnapshot()).toMatchObject({ registrations: 3, graphNodes: 3, graphEdges: 1 })
    runtime.destroy()
  })

  it('detects direct, indirect and target-prefix conflicts without leaking registration', () => {
    const { kernel, runtime } = createDerivedFixture()
    kernel.set('a', 1)
    runtime.derive({ id: 'a-b', from: 'a', to: 'b', compute: value => value })
    expect(() => runtime.derive({ id: 'b-a', from: 'b', to: 'a', compute: value => value })).toThrow(RaphDerivedCycleError)
    expect(() => runtime.derive({ id: 'writer', from: 'x', to: 'b.child', immediate: false, compute: value => value })).toThrow(RaphDerivedTargetWriteError)
    expect(kernel.getDerivedSnapshot()).toMatchObject({ registrations: 1, graphNodes: 1 })
    runtime.destroy()
  })

  it('continues a downstream branch after removing an intermediate derive with target cleanup', () => {
    const { kernel, runtime } = createDerivedFixture()
    kernel.set('source', 2)
    const middle = runtime.derive({
      id: 'middle', from: 'source', to: 'middle', disposeTarget: 'delete', compute: value => Number(value) * 2,
    })
    runtime.derive({ id: 'downstream', from: 'middle', to: 'result', compute: value => value ?? 'empty' })
    expect(kernel.get('result')).toBe(4)
    middle.dispose()
    expect(kernel.get('middle')).toBeUndefined()
    expect(kernel.get('result')).toBe('empty')
    runtime.destroy()
  })
})
