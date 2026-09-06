import type { RaphMetaWatch } from '@/domain/reactivity/RaphMetaWatch'
import type { PhaseExecutorContext, PhaseName } from '@/domain/types/phase.types'

import { describe, expect, it, vi } from 'vitest'

import { RaphKernel } from '@/domain/core/RaphKernel'
import { RaphNode } from '@/domain/core/RaphNode'
import { SchedulerType } from '@/domain/types/base.types'

describe('транзакции Data и Meta Raph', () => {
  it('инвалидирует runtime один раз и observer читает финальное состояние обоих слоёв', () => {
    const kernel = new RaphKernel()
    const runtime = kernel.createRuntime({ scheduler: SchedulerType.Sync })
    const node = new RaphNode(runtime, { id: 'node' })
    const snapshots: unknown[] = []
    runtime.definePhases([{
      name: 'render' as PhaseName,
      traversal: 'dirty-only',
      routes: [],
      each: () => snapshots.push({ data: kernel.get('row.value'), meta: kernel.meta.get('row.value', 'optimistic') }),
    }])
    runtime.addNode(node)
    kernel.set('row.value', 'A')
    runtime.observeData(node, 'row.value', { phase: 'render' })
    runtime.observeMeta(node, 'row.value', { phase: 'render' })
    const run = vi.spyOn(runtime, 'run')

    kernel.transaction(() => {
      kernel.set('row.value', 'B')
      kernel.meta.set('row.value', 'optimistic', { status: 'waiting' })
    })

    expect(run).toHaveBeenCalledTimes(1)
    expect(snapshots).toEqual([{ data: 'B', meta: { status: 'waiting' } }])
  })

  it('сохраняет delivery semantics при ошибке callback и не откатывает записанные значения', () => {
    const kernel = new RaphKernel()
    kernel.set('row.value', 1)
    expect(() => kernel.transaction(() => {
      kernel.set('row.value', 2)
      kernel.meta.set('row.value', 'test', true)
      throw new Error('failed callback')
    })).toThrow('failed callback')
    expect(kernel.get('row.value')).toBe(2)
    expect(kernel.meta.get('row.value', 'test')).toBe(true)
  })

  it('доставляет все Meta events transaction одним callback без схлопывания', () => {
    const kernel = new RaphKernel()
    const runtime = kernel.createRuntime({ scheduler: SchedulerType.Sync })
    const batches: string[][] = []
    runtime.definePhases([{
      name: '__watch' as PhaseName,
      traversal: 'dirty-only',
      routes: [],
      each: (context: PhaseExecutorContext) => (context.node as RaphMetaWatch).run(context),
    }])
    kernel.set('row.value', 1)
    runtime.meta.watch('row.value', ({ events }) => {
      batches.push(events.map(event => event.kind))
    })

    kernel.transaction(() => {
      kernel.meta.set('row.value', 'test', { count: 1 })
      kernel.meta.merge('row.value', 'test', { count: 2 })
    })

    expect(batches).toEqual([['set', 'merge']])
    runtime.destroy()
  })
})
