import { describe, expect, it } from 'vitest'
import { createDerivedFixture } from './derived.fixtures.ts'

describe('очистка памяти производных данных Raph', () => {
  it('освобождает детерминированные ресурсы реестра после повторных create/dispose', () => {
    const { kernel, runtime } = createDerivedFixture()
    kernel.set('source', 1)
    const count = stressEnabled() ? 100_000 : 10_000
    for (let index = 0; index < count; index++) {
      const handle = runtime.derive({
        id: `memory-${index}`,
        from: 'source',
        to: `targets.t${index}`,
        immediate: false,
        compute: value => value,
      })
      handle.dispose()
    }
    expect(kernel.getDerivedSnapshot()).toEqual({
      registrations: 0,
      graphNodes: 0,
      graphEdges: 0,
      sourceRoutes: 0,
      targetRoutes: 0,
      dirtyHandles: 0,
      pendingKeys: 0,
      errors: 0,
      stabilizing: false,
    })
    expect(runtime.root.children).toHaveLength(0)
    runtime.destroy()
  })

  it('очищает цепочки, fan-out, приостановленные и неудачные регистрации', () => {
    const { kernel, runtime } = createDerivedFixture()
    kernel.set('source', 1)
    const count = stressEnabled() ? 10_000 : 1_000
    const handles = []
    for (let index = 0; index < count; index++) {
      const handle = runtime.derive({
        id: `fan-${index}`,
        from: 'source',
        to: `fan.t${index}`,
        immediate: false,
        compute: value => value,
      })
      if (index % 2 === 0) {
        handle.pause()
      }
      handles.push(handle)
    }
    expect(() => runtime.derive({
      id: 'failed',
      from: 'source',
      to: 'failed',
      compute: () => { throw new Error('expected') },
    })).toThrow()
    handles.forEach(handle => handle.dispose())
    expect(kernel.getDerivedSnapshot()).toMatchObject({
      registrations: 0,
      graphNodes: 0,
      graphEdges: 0,
      dirtyHandles: 0,
      pendingKeys: 0,
      errors: 0,
    })
    expect(runtime.root.children).toHaveLength(0)
    runtime.destroy()
  })

  it('сообщает heap до регистрации и после очистки runtime', () => {
    const { kernel, runtime } = createDerivedFixture()
    kernel.set('source', { payload: Array.from({ length: 100 }).fill('x') })
    forceGc()
    const before = heapUsed()
    const count = stressEnabled() ? 100_000 : 10_000
    for (let index = 0; index < count; index++) {
      runtime.derive({
        id: `retained-${index}`,
        from: 'source',
        to: `retained.t${index}`,
        immediate: false,
        compute: value => value,
      })
    }
    const registered = heapUsed()
    runtime.reset()
    forceGc()
    const after = heapUsed()
    console.table({
      count,
      beforeMB: toMb(before),
      registeredMB: toMb(registered),
      afterCleanupMB: toMb(after),
      retainedDeltaMB: toMb(after - before),
    })
    expect(kernel.getDerivedSnapshot().registrations).toBe(0)
  })

  it('сообщает о сборке WeakRef освобождённого замыкания compute', () => {
    const { kernel, runtime } = createDerivedFixture()
    const weak = registerDisposableClosure(runtime)
    forceGc()
    console.info('[RaphDerived memory] disposed closure collected:', weak.deref() === undefined)
    expect(kernel.getDerivedSnapshot().registrations).toBe(0)
    runtime.destroy()
  })
})

function registerDisposableClosure(runtime: ReturnType<typeof createDerivedFixture>['runtime']): WeakRef<{ data: number[] }> {
  const captured = { data: Array.from({ length: 100_000 }).fill(1) }
  const weak = new WeakRef(captured)
  runtime.derive({
    from: 'source',
    to: 'target',
    immediate: false,
    compute: value => captured.data.length + Number(value),
  }).dispose()
  return weak
}

function stressEnabled(): boolean {
  return (globalThis as any).process?.env?.RAPH_DERIVED_STRESS === '1'
}

function heapUsed(): number {
  return (globalThis as any).process?.memoryUsage?.().heapUsed ?? 0
}

function forceGc(): void {
  const gc = (globalThis as any).gc
  if (typeof gc === 'function') {
    for (let index = 0; index < 5; index++) {
      gc()
    }
  }
}

function toMb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(2)
}
