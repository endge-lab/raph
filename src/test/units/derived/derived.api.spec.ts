import { describe, expect, it } from 'vitest'
import { Raph } from '@/domain/core/Raph'
import { RaphDerivedNode } from '@/domain/derived/RaphDerivedNode'
import { full } from '@/domain/derived/strategies/full'
import { RaphDerivedPathError, RaphDerivedTargetWriteError } from '@/domain/types/derived.types'
import { createDerivedFixture } from '../../../units/derived/derived.fixtures.ts'

describe('Raph derived API', () => {
  it('exposes derive and transaction on the default static runtime', () => {
    Raph.set('derivedStatic.source', 2)
    const handle = Raph.derive({
      id: 'static-double', from: 'derivedStatic.source', to: 'derivedStatic.target',
      compute: value => Number(value) * 2,
    })
    Raph.transaction(() => Raph.set('derivedStatic.source', 3))
    expect(Raph.get('derivedStatic.target')).toBe(6)
    expect(Raph.getDerivedSnapshot().registrations).toBe(1)
    handle.dispose()
    Raph.app.reset()
  })

  it('creates a system node and exposes lifecycle snapshot', () => {
    const { kernel, runtime } = createDerivedFixture()
    kernel.set('source.value', 2)
    const handle = runtime.derive({
      id: 'double', from: 'source.value', to: 'target.value', strategy: full(),
      compute: value => Number(value) * 2,
    })

    expect(handle.node).toBeInstanceOf(RaphDerivedNode)
    expect(runtime.graph.hasNode(handle.node)).toBe(true)
    expect(handle.node.parent).toBe(runtime.root)
    expect(kernel.get('target.value')).toBe(4)
    expect(handle.snapshot()).toMatchObject({ id: 'double', status: 'active', strategy: 'full', computeCount: 1 })
    runtime.destroy()
  })

  it('attaches a system node to root before explicit runtime init', () => {
    const { kernel } = createDerivedFixture()
    const runtime = kernel.createRuntime({ id: 'not-initialized' })
    kernel.set('uninitialized.source', 2)
    const handle = runtime.derive({
      from: 'uninitialized.source',
      to: 'uninitialized.target',
      compute: value => Number(value) * 2,
    })

    expect(runtime.graph.hasNode(runtime.root)).toBe(true)
    expect(handle.node.parent).toBe(runtime.root)
    expect(kernel.get('uninitialized.target')).toBe(4)
    runtime.destroy()
  })

  it('supports immediate=false and rejects invalid paths and duplicate ids', () => {
    const { runtime } = createDerivedFixture()
    const handle = runtime.derive({
      id: 'later', from: 'source', to: 'target', immediate: false, compute: value => value,
    })
    expect(handle.snapshot().computeCount).toBe(0)
    expect(() => runtime.derive({ id: 'later', from: 'other', to: 'another', compute: value => value })).toThrow(RaphDerivedPathError)
    expect(() => runtime.derive({ id: '  ', from: 'other', to: 'another', compute: value => value })).toThrow(RaphDerivedPathError)
    expect(() => runtime.derive({ from: 'source.*', to: 'target.other', compute: value => value })).toThrow(RaphDerivedPathError)
    expect(() => runtime.derive({ from: 'same', to: 'same.child', compute: value => value })).toThrow(RaphDerivedPathError)
    runtime.destroy()
  })

  it('protects an active target and releases it after dispose', () => {
    const { kernel, runtime } = createDerivedFixture()
    kernel.set('source', 1)
    const handle = runtime.derive({ from: 'source', to: 'target', compute: value => value })
    expect(() => kernel.set('target', 3)).toThrow(RaphDerivedTargetWriteError)
    expect(() => kernel.merge('target', { x: 1 })).toThrow(RaphDerivedTargetWriteError)
    expect(() => kernel.delete('target')).toThrow(RaphDerivedTargetWriteError)
    handle.dispose()
    expect(runtime.root.children).not.toContain(handle.node)
    kernel.set('target', 3)
    expect(kernel.get('target')).toBe(3)
    runtime.destroy()
  })
})
