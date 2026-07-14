import { describe, expect, it } from 'vitest'
import { RaphKernel } from '@/domain/core/RaphKernel'
import { RaphNode } from '@/domain/core/RaphNode'
import { SchedulerType } from '@/domain/types/base.types'
import type { PhaseExecutorContext, PhaseName } from '@/domain/types/phase.types'

describe('RaphRuntime cleanup', () => {
  it('removes observeData subscriptions on node remove and runtime destroy', () => {
    const kernel = new RaphKernel()
    const runtime = kernel.createRuntime({ id: 'runtime', scheduler: SchedulerType.Sync })
    let calls = 0

    runtime.definePhases([
      {
        name: 'update' as PhaseName,
        traversal: 'dirty-only',
        routes: [],
        each: (_ctx: PhaseExecutorContext) => {
          calls++
        },
      },
    ])

    const first = new RaphNode(runtime, { id: 'first' })
    runtime.addNode(first)
    runtime.observeData(first, 'data.first', { phase: 'update' })
    first.remove()

    kernel.set('data.first', 1)
    expect(calls).toBe(0)

    const second = new RaphNode(runtime, { id: 'second' })
    runtime.addNode(second)
    runtime.observeData(second, 'data.second', { phase: 'update' })
    runtime.destroy()

    kernel.set('data.second', 2)
    expect(calls).toBe(0)
  })
})
