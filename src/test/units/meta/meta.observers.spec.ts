import type { RaphMetaWatch } from '@/domain/reactivity/RaphMetaWatch'

import type { PhaseExecutorContext, PhaseName } from '@/domain/types/phase.types'

import { describe, expect, it } from 'vitest'
import { RaphKernel } from '@/domain/core/RaphKernel'
import { RaphNode } from '@/domain/core/RaphNode'
import { SchedulerType } from '@/domain/types/base.types'

describe('наблюдатели Meta-plane Raph', () => {
  it('доставляет exact и wildcard observers с фильтром namespace', () => {
    const kernel = new RaphKernel()
    const runtime = kernel.createRuntime({ scheduler: SchedulerType.Sync })
    const events: string[] = []
    const exactEvents: string[] = []
    runtime.definePhases([{
      name: '__watch' as PhaseName,
      traversal: 'dirty-only',
      routes: [],
      each: (context: PhaseExecutorContext) => (context.node as RaphMetaWatch).run(context),
    }])
    kernel.set('rows', [{ id: 1, value: 'A' }])

    runtime.meta.watch('rows[*].value', ({ events: batch }) => {
      events.push(...batch.map(event => `${event.kind}:${event.namespace}`))
    }, { namespace: 'optimistic', wildcardDynamic: true })
    runtime.meta.watch('rows[id=1].value', ({ events: batch }) => {
      exactEvents.push(...batch.map(event => `${event.kind}:${event.namespace}`))
    }, { namespace: 'optimistic' })

    kernel.meta.set('rows[id=1].value', 'validation', true)
    kernel.meta.set('rows[id=1].value', 'optimistic', { status: 'waiting' })

    expect(events).toEqual(['set:optimistic'])
    expect(exactEvents).toEqual(['set:optimistic'])
  })

  it('meta mutation не уведомляет Data observer, а обычная смена owner не уведомляет Meta observer', () => {
    const kernel = new RaphKernel()
    const runtime = kernel.createRuntime({ scheduler: SchedulerType.Sync })
    const dataNode = new RaphNode(runtime, { id: 'data' })
    const metaNode = new RaphNode(runtime, { id: 'meta' })
    let dataRuns = 0
    let metaRuns = 0
    runtime.definePhases([
      { name: 'data' as PhaseName, traversal: 'dirty-only', routes: [], each: () => dataRuns++ },
      { name: 'meta' as PhaseName, traversal: 'dirty-only', routes: [], each: () => metaRuns++ },
    ])
    runtime.addNode(dataNode)
    runtime.addNode(metaNode)
    kernel.set('row.value', 1)
    kernel.meta.set('row.value', 'optimistic', true)
    runtime.observeData(dataNode, 'row.value', { phase: 'data' })
    runtime.observeMeta(metaNode, 'row.value', { phase: 'meta' })

    kernel.meta.set('row.value', 'optimistic', false)
    expect(dataRuns).toBe(0)
    expect(metaRuns).toBe(1)

    kernel.set('row.value', 2)
    expect(dataRuns).toBe(1)
    expect(metaRuns).toBe(1)
  })

  it('meta mutation не запускает derived graph', () => {
    const kernel = new RaphKernel()
    const runtime = kernel.createRuntime({ scheduler: SchedulerType.Sync })
    kernel.set('source', 1)
    let computes = 0
    runtime.derive({
      from: 'source',
      to: 'target',
      immediate: true,
      compute: (value) => {
        computes++
        return value
      },
    })
    computes = 0

    kernel.meta.set('source', 'test', true)

    expect(computes).toBe(0)
    runtime.destroy()
  })
})
