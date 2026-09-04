import { describe, expect, it } from 'vitest'
import { RaphDerivedDisposedError } from '@/domain/types/derived.types'
import { createDerivedFixture } from '../../../units/derived/derived.fixtures.ts'

describe('жизненный цикл производных данных Raph', () => {
  it('приостанавливается без накопления изменений и возобновляется через полный пересчёт', () => {
    const { kernel, runtime } = createDerivedFixture()
    kernel.set('source', 1)
    const handle = runtime.derive({ from: 'source', to: 'target', compute: value => Number(value) * 2 })
    handle.pause()
    kernel.transaction(() => {
      for (let index = 0; index < 100; index++) {
        kernel.set('source', index)
      }
    })
    expect(kernel.get('target')).toBe(2)
    expect(handle.snapshot()).toMatchObject({ status: 'paused', stale: true, computeCount: 1 })
    expect(handle.node.stale).toBe(true)
    expect(kernel.getDerivedSnapshot()).toMatchObject({ pendingKeys: 0, dirtyHandles: 0 })
    handle.resume()
    expect(kernel.get('target')).toBe(198)
    expect(handle.snapshot()).toMatchObject({ status: 'active', stale: false, computeCount: 2 })
    runtime.destroy()
  })

  it('освобождает все регистрации ядра через delegate диагностики', () => {
    const { kernel, runtime } = createDerivedFixture()
    kernel.set('source', 1)
    runtime.derive({ from: 'source', to: 'a', compute: value => value })
    runtime.derive({ from: 'source', to: 'b', compute: value => value })
    kernel.disposeAllDerived()
    expect(kernel.getDerivedSnapshot().registrations).toBe(0)
    expect(runtime.root.children).toHaveLength(0)
    runtime.destroy()
  })

  it('идемпотентно освобождает, сохраняет target и очищает все ресурсы реестра', () => {
    const { kernel, runtime } = createDerivedFixture()
    kernel.set('source', 3)
    const handle = runtime.derive({ from: 'source', to: 'target', compute: value => value })
    handle.dispose()
    handle.dispose()
    expect(handle.status).toBe('disposed')
    expect(kernel.get('target')).toBe(3)
    expect(kernel.getDerivedSnapshot()).toMatchObject({ registrations: 0, graphNodes: 0, sourceRoutes: 0, targetRoutes: 0 })
    expect(() => handle.recompute()).toThrow(RaphDerivedDisposedError)
    expect(() => handle.pause()).toThrow(RaphDerivedDisposedError)
    expect(() => handle.resume()).toThrow(RaphDerivedDisposedError)
    runtime.destroy()
  })

  it('автоматически очищает производные узлы при reset runtime', () => {
    const { kernel, runtime } = createDerivedFixture()
    kernel.set('source', 1)
    const handle = runtime.derive({ from: 'source', to: 'target', compute: value => value })
    runtime.reset()
    expect(handle.status).toBe('disposed')
    expect(kernel.getDerivedSnapshot().registrations).toBe(0)
  })

  it('поддерживает ручной полный пересчёт и очищает lastError', () => {
    const { kernel, runtime } = createDerivedFixture()
    kernel.set('source', 1)
    let fail = true
    const handle = runtime.derive({
      from: 'source',
      to: 'target',
      immediate: false,
      compute: (value) => {
        if (fail) {
          throw new Error('temporary')
        }
        return value
      },
    })
    expect(() => handle.recompute()).toThrow('temporary')
    expect(handle.status).toBe('error')
    expect(handle.snapshot().lastError).toContain('temporary')
    fail = false
    handle.recompute()
    expect(handle.status).toBe('active')
    expect(handle.lastError).toBeNull()
    runtime.destroy()
  })

  it('разрешает напрямую повторять операцию dispose системного узла', () => {
    const { kernel, runtime } = createDerivedFixture()
    kernel.set('source', 1)
    const handle = runtime.derive({ from: 'source', to: 'target', compute: value => value })
    handle.node.dispose()
    handle.node.dispose()
    expect(handle.status).toBe('disposed')
    runtime.destroy()
  })
})
