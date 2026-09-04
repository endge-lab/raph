import type { PhaseExecutorContext, PhaseName } from '@/domain/types/phase.types'

import { describe, expect, it, vi } from 'vitest'

import { RaphKernel } from '@/domain/core/RaphKernel'
import { RaphNode } from '@/domain/core/RaphNode'
import { filterByKey } from '@/domain/derived/strategies/filter-by-key'
import { SchedulerType } from '@/domain/types/base.types'
import { createDerivedFixture } from './derived.fixtures.ts'

describe('интеграция производной стратегии filterByKey Raph', () => {
  it('однократно стабилизирует двухэтапный фильтрованный граф на транзакцию', () => {
    const { kernel, runtime } = createDerivedFixture()
    kernel.set('source.rows', [
      { id: 1, visible: true, priority: true, value: 1 },
      { id: 2, visible: false, priority: true, value: 2 },
      { id: 3, visible: true, priority: false, value: 3 },
    ])
    const visibleCompute = vi.fn((rows: Row[]) => rows
      .filter(row => row.visible)
      .map(row => ({ ...row, projected: row.value * 10 })))
    const priorityCompute = vi.fn((rows: ProjectedRow[]) => rows
      .filter(row => row.priority)
      .map(row => ({ id: row.id, label: `${row.id}:${row.projected}` })))
    runtime.derive({
      id: 'visible',
      from: 'source.rows',
      to: 'derived.visible',
      strategy: filterByKey('id'),
      compute: visibleCompute,
    })
    runtime.derive({
      id: 'priority',
      from: 'derived.visible',
      to: 'derived.priority',
      strategy: filterByKey('id'),
      compute: priorityCompute,
    })

    kernel.transaction(() => {
      kernel.set('source.rows[id=3].priority', true)
      kernel.set('source.rows[id=2].visible', true)
      kernel.set('source.rows[id=1].visible', false)
    })

    expect(visibleCompute).toHaveBeenCalledTimes(2)
    expect(visibleCompute.mock.calls[1]?.[0].map(row => row.id)).toEqual([1, 2, 3])
    expect(priorityCompute).toHaveBeenCalledTimes(2)
    expect(priorityCompute.mock.calls[1]?.[0].map(row => row.id)).toEqual([2, 3])
    expect(kernel.get('derived.visible')).toEqual([
      { id: 2, visible: true, priority: true, value: 2, projected: 20 },
      { id: 3, visible: true, priority: true, value: 3, projected: 30 },
    ])
    expect(kernel.get('derived.priority')).toEqual([
      { id: 2, label: '2:20' },
      { id: 3, label: '3:30' },
    ])
    expect(kernel.getDerivedSnapshot()).toMatchObject({ registrations: 2, graphNodes: 2, graphEdges: 1, errors: 0 })
    runtime.destroy()
  })

  it('доставляет фазам после стабилизации только материализованные изменения по ключам', () => {
    const { kernel, runtime } = createDerivedFixture()
    kernel.set('source.rows', [
      { id: 1, visible: true, value: 1 },
      { id: 2, visible: false, value: 2 },
    ])
    runtime.derive({
      from: 'source.rows',
      to: 'target.rows',
      strategy: filterByKey('id'),
      compute: (rows: Array<{ id: number, visible: boolean, value: number }>) => rows.filter(row => row.visible),
    })

    const observer = new RaphNode(runtime, { id: 'target-observer' })
    runtime.addNode(observer)
    const batches: Array<{ paths: string[], snapshot: unknown }> = []
    runtime.definePhases([{
      name: 'render' as PhaseName,
      routes: [],
      traversal: 'dirty-only',
      each: (ctx: PhaseExecutorContext) => batches.push({
        paths: (ctx.events ?? []).map(event => event.canonical),
        snapshot: kernel.get('target.rows'),
      }),
    }])
    runtime.observeData(observer, 'target.rows.*', { phase: 'render' })

    kernel.transaction(() => {
      kernel.set('source.rows[id=2].value', 20)
      kernel.set('source.rows[id=1].value', 10)
    })
    expect(batches).toEqual([{
      paths: ['target.rows[id=1]'],
      snapshot: [{ id: 1, visible: true, value: 10 }],
    }])

    kernel.set('source.rows[id=2].value', 21)
    expect(batches).toHaveLength(1)
    runtime.destroy()
  })

  it('распространяет изменения состава по ключам между runtime одного ядра', () => {
    const kernel = new RaphKernel()
    const sourceRuntime = kernel.createRuntime({ id: 'source-runtime', scheduler: SchedulerType.Sync })
    const consumerRuntime = kernel.createRuntime({ id: 'consumer-runtime', scheduler: SchedulerType.Sync })
    sourceRuntime.init()
    consumerRuntime.init()
    kernel.set('source.rows', [{ id: 1, active: true }, { id: 2, active: false }])

    const upstream = sourceRuntime.derive({
      from: 'source.rows',
      to: 'shared.active',
      strategy: filterByKey('id'),
      compute: (rows: Array<{ id: number, active: boolean }>) => rows.filter(row => row.active),
    })
    const downstream = consumerRuntime.derive({
      from: 'shared.active',
      to: 'consumer.rows',
      strategy: filterByKey('id'),
      compute: (rows: Array<{ id: number, active: boolean }>) => rows.map(row => ({ id: row.id, text: `row-${row.id}` })),
    })

    kernel.transaction(() => {
      kernel.set('source.rows[id=1].active', false)
      kernel.set('source.rows[id=2].active', true)
    })
    expect(kernel.get('shared.active')).toEqual([{ id: 2, active: true }])
    expect(kernel.get('consumer.rows')).toEqual([{ id: 2, text: 'row-2' }])
    expect(upstream.snapshot()).toMatchObject({ incrementalComputeCount: 1 })
    expect(downstream.snapshot()).toMatchObject({ incrementalComputeCount: 1 })

    sourceRuntime.destroy()
    expect(upstream.status).toBe('disposed')
    expect(downstream.status).toBe('active')
    expect(kernel.getDerivedSnapshot()).toMatchObject({ registrations: 1, graphNodes: 1, graphEdges: 0 })
    consumerRuntime.destroy()
  })

  it('объединяет приостановленные изменения по ключам в один полный пересчёт при resume', () => {
    const { kernel, runtime } = createDerivedFixture()
    kernel.set('source.rows', [{ id: 1, visible: true }, { id: 2, visible: false }])
    const compute = vi.fn((rows: Array<{ id: number, visible: boolean }>) => rows.filter(row => row.visible))
    const handle = runtime.derive({ from: 'source.rows', to: 'target.rows', strategy: filterByKey('id'), compute })
    handle.pause()

    kernel.transaction(() => {
      kernel.set('source.rows[id=1].visible', false)
      kernel.set('source.rows[id=2].visible', true)
    })
    expect(kernel.get('target.rows')).toEqual([{ id: 1, visible: true }])
    expect(handle.snapshot()).toMatchObject({ status: 'paused', stale: true, computeCount: 1 })

    handle.resume()
    expect(kernel.get('target.rows')).toEqual([{ id: 2, visible: true }])
    expect(handle.snapshot()).toMatchObject({ status: 'active', stale: false, fullComputeCount: 2, incrementalComputeCount: 0 })
    expect(compute).toHaveBeenCalledTimes(2)
    runtime.destroy()
  })
})

interface Row {
  id: number
  visible: boolean
  priority: boolean
  value: number
}

interface ProjectedRow extends Row {
  projected: number
}
