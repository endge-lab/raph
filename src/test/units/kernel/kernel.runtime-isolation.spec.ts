import { describe, expect, it } from 'vitest'
import { RaphKernel } from '@/domain/core/RaphKernel'
import { RaphNode } from '@/domain/core/RaphNode'
import { SchedulerType } from '@/domain/types/base.types'
import type { PhaseExecutorContext, PhaseName } from '@/domain/types/phase.types'

describe('RaphKernel runtime isolation', () => {
  it('routes business data changes only to subscribed runtime lanes', () => {
    const kernel = new RaphKernel()
    const nova = kernel.createRuntime({ id: 'nova', scheduler: SchedulerType.Sync })
    const lowCode = kernel.createRuntime({ id: 'low-code', scheduler: SchedulerType.Sync })

    let novaUpdates = 0
    let lowCodeUpdates = 0

    nova.definePhases([
      {
        name: 'update' as PhaseName,
        traversal: 'dirty-only',
        routes: [],
        each: (_ctx: PhaseExecutorContext) => {
          novaUpdates++
        },
      },
    ])
    lowCode.definePhases([
      {
        name: 'patch-dom' as PhaseName,
        traversal: 'dirty-only',
        routes: [],
        each: (_ctx: PhaseExecutorContext) => {
          lowCodeUpdates++
        },
      },
    ])

    const groupsNode = new RaphNode(nova, { id: 'groups' })
    const fieldNode = new RaphNode(lowCode, { id: 'field' })
    nova.addNode(groupsNode)
    lowCode.addNode(fieldNode)

    nova.observeData(groupsNode, 'timeline.groups.version', { phase: 'update' })
    lowCode.observeData(fieldNode, 'document.fields[id="name"].value', { phase: 'patch-dom' })

    kernel.set('timeline.groups.version', 1)

    expect(novaUpdates).toBe(1)
    expect(lowCodeUpdates).toBe(0)
  })
})
