import type { PhaseExecutorContext, PhaseName } from '@/domain/types/phase.types'
import { describe, expect, it, vi } from 'vitest'
import { RaphKernel } from '@/domain/core/RaphKernel'
import { RaphNode } from '@/domain/core/RaphNode'
import { SchedulerType } from '@/domain/types/base.types'

describe('raphKernel transaction', () => {
  it('coalesces invalidation and batches events per runtime', () => {
    const kernel = new RaphKernel()
    const runtime = kernel.createRuntime({ id: 'runtime', scheduler: SchedulerType.Sync })
    const node = new RaphNode(runtime, { id: 'node' })
    const eventBatches: Array<number> = []

    runtime.definePhases([
      {
        name: 'update' as PhaseName,
        traversal: 'dirty-only',
        routes: [],
        each: (ctx: PhaseExecutorContext) => {
          eventBatches.push(ctx.events?.length ?? 0)
        },
      },
    ])
    runtime.addNode(node)
    runtime.observeData(node, 'items.*', { phase: 'update' })

    const runSpy = vi.spyOn(runtime, 'run')

    kernel.transaction(() => {
      kernel.set('items.a', 1)
      kernel.set('items.b', 2)
      kernel.set('items.c', 3)
    })

    expect(runSpy).toHaveBeenCalledTimes(1)
    expect(eventBatches).toEqual([3])
  })
})
