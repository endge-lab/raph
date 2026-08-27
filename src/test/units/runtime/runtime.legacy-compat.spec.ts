import type { PhaseExecutorContext, PhaseName } from '@/domain/types/phase.types'
import { describe, expect, it } from 'vitest'
import { RaphApp } from '@/domain/core/RaphApp'
import { RaphNode } from '@/domain/core/RaphNode'
import { SchedulerType } from '@/domain/types/base.types'

describe('raphRuntime legacy compatibility', () => {
  it('keeps phase.routes + track() delivery working through RaphApp', () => {
    const raph = new RaphApp()
    raph.options({ scheduler: SchedulerType.Sync })

    let calls = 0
    raph.definePhases([
      {
        name: 'update' as PhaseName,
        traversal: 'dirty-only',
        routes: ['data.*'],
        each: (_ctx: PhaseExecutorContext) => {
          calls++
        },
      },
    ])

    const node = new RaphNode(raph, { id: 'legacy' })
    raph.addNode(node)
    raph.track(node, 'data.*')
    raph.set('data.x', 1)

    expect(calls).toBe(1)
  })
})
