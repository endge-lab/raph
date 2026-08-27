import type { DataPathDef } from '@/domain/types/base.types'
import { describe, expect, it } from 'vitest'
import { RaphKernel } from '@/domain/core/RaphKernel'
import { DefaultDataAdapter } from '@/domain/entities/data-adapter'
import { DataPath } from '@/domain/entities/DataPath'
import { SchedulerType } from '@/domain/types/base.types'
import {
  RaphDerivedComputeError,
  RaphDerivedReentrancyError,
  RaphDerivedStrategyError,
} from '@/domain/types/derived.types'
import { createDerivedFixture } from '../../../units/derived/derived.fixtures.ts'

class TargetFailingAdapter extends DefaultDataAdapter {
  public failTarget = false

  public override set(path: DataPathDef, value: unknown, opts?: { vars?: Record<string, any> }): void {
    if (this.failTarget && DataPath.from(path).toStringPath().startsWith('target')) {
      throw new Error('adapter target commit failed')
    }
    super.set(path, value, opts)
  }
}

class DeleteFailingAdapter extends DefaultDataAdapter {
  public override delete(path: DataPathDef): void {
    if (DataPath.from(path).toStringPath().startsWith('target')) {
      throw new Error('adapter cleanup failed')
    }
    super.delete(path)
  }
}

describe('raph derived errors', () => {
  it('keeps last-good target, exposes error and retries on next mutation', () => {
    const { kernel, runtime } = createDerivedFixture()
    kernel.set('source', 1)
    const handle = runtime.derive({
      from: 'source',
      to: 'target',
      compute: (value) => {
        if (value === 2) {
          throw new Error('bad value')
        }
        return Number(value) * 10
      },
    })
    expect(() => kernel.set('source', 2)).toThrow(RaphDerivedComputeError)
    expect(kernel.get('source')).toBe(2)
    expect(kernel.get('target')).toBe(10)
    expect(handle.status).toBe('error')
    kernel.set('source', 3)
    expect(kernel.get('target')).toBe(30)
    expect(handle.status).toBe('active')
    expect(handle.lastError).toBeNull()
    runtime.destroy()
  })

  it('rejects async compute and cleans failed registration', () => {
    const { kernel, runtime } = createDerivedFixture()
    kernel.set('source', 1)
    expect(() => runtime.derive({
      from: 'source',
      to: 'target',
      compute: async value => value,
    })).toThrow(RaphDerivedStrategyError)
    expect(kernel.getDerivedSnapshot().registrations).toBe(0)
    runtime.destroy()
  })

  it('rejects reentrant store mutations from compute', () => {
    const { kernel, runtime } = createDerivedFixture()
    kernel.set('source', 1)
    expect(() => runtime.derive({
      from: 'source',
      to: 'target',
      compute: (value) => {
        kernel.set('side-effect', value)
        return value
      },
    })).toThrow(RaphDerivedComputeError)
    expect((() => {
      try {
        runtime.derive({
          from: 'source',
          to: 'another-target',
          compute: (value) => {
            kernel.set('side-effect', value)
            return value
          },
        })
      }
      catch (error) {
        return (error as Error).cause
      }
    })()).toBeInstanceOf(RaphDerivedReentrancyError)
    runtime.destroy()
  })

  it('continues independent branches and aggregates their compute errors', () => {
    const { kernel, runtime } = createDerivedFixture()
    kernel.set('source', 1)
    runtime.derive({
      id: 'bad-a',
      from: 'source',
      to: 'bad.a',
      compute: () => { throw new Error('a') },
      immediate: false,
    })
    runtime.derive({
      id: 'good',
      from: 'source',
      to: 'good',
      compute: value => Number(value) * 2,
    })
    runtime.derive({
      id: 'bad-b',
      from: 'source',
      to: 'bad.b',
      compute: () => { throw 'b' },
      immediate: false,
    })
    expect(() => kernel.set('source', 3)).toThrow(AggregateError)
    expect(kernel.get('good')).toBe(6)
    expect(kernel.get('bad.a')).toBeUndefined()
    expect(kernel.getDerivedSnapshot().errors).toBe(2)
    runtime.destroy()
  })

  it('forbids registry mutations from compute', () => {
    const { kernel, runtime } = createDerivedFixture()
    kernel.set('source', 1)
    expect(() => runtime.derive({
      from: 'source',
      to: 'target',
      compute: (value) => {
        runtime.derive({ from: 'other', to: 'another', immediate: false, compute: item => item })
        return value
      },
    })).toThrow(RaphDerivedComputeError)
    expect(kernel.getDerivedSnapshot().registrations).toBe(0)
    runtime.destroy()
  })

  it('wraps adapter commit errors in immediate and stabilization paths', () => {
    const adapter = new TargetFailingAdapter()
    const kernel = new RaphKernel({ adapter })
    const runtime = kernel.createRuntime({ scheduler: SchedulerType.Sync })
    runtime.init()
    kernel.set('source', 1)

    adapter.failTarget = true
    expect(() => runtime.derive({ from: 'source', to: 'target.immediate', compute: value => value })).toThrow(RaphDerivedComputeError)
    adapter.failTarget = false
    runtime.derive({ from: 'source', to: 'target.stable', compute: value => value })
    adapter.failTarget = true
    expect(() => kernel.set('source', 2)).toThrow(RaphDerivedComputeError)
    runtime.destroy()
  })

  it('preserves registration error when cleanup also fails', () => {
    const adapter = new DeleteFailingAdapter()
    const kernel = new RaphKernel({ adapter })
    const runtime = kernel.createRuntime({ scheduler: SchedulerType.Sync })
    runtime.init()
    kernel.set('source', 1)
    expect(() => runtime.derive({
      from: 'source',
      to: 'target',
      disposeTarget: 'delete',
      compute: () => { throw new Error('original compute') },
    })).toThrow('original compute')
    expect(kernel.getDerivedSnapshot().registrations).toBe(0)
    runtime.destroy()
  })
})
