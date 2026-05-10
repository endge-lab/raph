import { describe, expect, it } from 'vitest'
import { RaphKernel } from '@/domain/core/RaphKernel'
import { RaphNode } from '@/domain/core/RaphNode'
import { SchedulerType } from '@/domain/types/base.types'
import type { PhaseExecutorContext, PhaseName } from '@/domain/types/phase.types'

describe('RaphRuntime.observeData', () => {
  it('marks a node dirty in the requested phase without phase.routes', () => {
    const kernel = new RaphKernel()
    const runtime = kernel.createRuntime({ id: 'runtime', scheduler: SchedulerType.Sync })
    const node = new RaphNode(runtime, { id: 'node' })
    const receivedEvents: Array<number> = []
    let runs = 0

    runtime.definePhases([
      {
        name: 'update' as PhaseName,
        traversal: 'dirty-only',
        routes: [],
        each: (ctx: PhaseExecutorContext) => {
          runs++
          receivedEvents.push(ctx.events?.length ?? 0)
        },
      },
    ])
    runtime.addNode(node)
    runtime.observeData(node, 'data.*', { phase: 'update' })

    kernel.transaction(() => {
      kernel.set('data.a', 1)
      kernel.set('data.b', 2)
    })

    expect(runs).toBe(1)
    expect(receivedEvents).toEqual([2])
  })
})
