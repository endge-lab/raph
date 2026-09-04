import type { PhaseName } from '@/domain/types/phase.types'
import { describe, expect, it } from 'vitest'
import { RaphKernel } from '@/domain/core/RaphKernel'
import { RaphNode } from '@/domain/core/RaphNode'
import { SchedulerType } from '@/domain/types/base.types'

describe('интеграция lifecycle runtime и router Raph', () => {
  it('возвращает состояние router к исходному после lifecycle-циклов уникальных путей', () => {
    const kernel = new RaphKernel()
    const runtime = kernel.createRuntime({ id: 'cycles', scheduler: SchedulerType.Sync })
    runtime.definePhases([{ name: 'update' as PhaseName, routes: [], traversal: 'dirty-only' }])

    for (let cycle = 0; cycle < 20; cycle++) {
      const nodes = Array.from({ length: 100 }, (_, index) => {
        const node = new RaphNode(runtime, { id: `node-${cycle}-${index}` })
        runtime.addNode(node)
        runtime.observeData(node, `pages[cycle=${cycle}].rows[id=${index}].value`, { phase: 'update' })
        return node
      })
      for (const node of nodes) {
        node.remove()
      }
    }

    const router = (runtime as unknown as { _nodeRouter: { _payloadMasks: Map<unknown, unknown>, _root: unknown } })._nodeRouter
    expect(router._payloadMasks.size).toBe(0)
    expect(router._root).toMatchObject({ exact: null, wc: null, param: null, paramAny: null })
  })

  it.each([SchedulerType.Sync, SchedulerType.Microtask, SchedulerType.RAF])(
    'никогда не уведомляет удалённый узел в scheduler %s',
    async (scheduler) => {
      const kernel = new RaphKernel()
      const runtime = kernel.createRuntime({ id: `scheduler-${scheduler}`, scheduler })
      let calls = 0
      runtime.definePhases([{
        name: 'update' as PhaseName,
        routes: [],
        traversal: 'dirty-only',
        each: () => calls++,
      }])
      const node = new RaphNode(runtime, { id: 'deleted' })
      runtime.addNode(node)
      runtime.observeData(node, 'page.rows.value', { phase: 'update' })
      node.remove()
      kernel.set('page.rows.value', 1)
      await new Promise(resolve => setTimeout(resolve, 25))
      expect(calls).toBe(0)
      runtime.destroy()
    },
  )

  it('не удаляет routes другого runtime в общем ядре', () => {
    const kernel = new RaphKernel()
    const first = kernel.createRuntime({ id: 'first', scheduler: SchedulerType.Sync })
    const second = kernel.createRuntime({ id: 'second', scheduler: SchedulerType.Sync })
    let firstCalls = 0
    let secondCalls = 0
    first.definePhases([{ name: 'update' as PhaseName, routes: [], traversal: 'dirty-only', each: () => firstCalls++ }])
    second.definePhases([{ name: 'update' as PhaseName, routes: [], traversal: 'dirty-only', each: () => secondCalls++ }])
    const firstNode = new RaphNode(first, { id: 'first-node' })
    const secondNode = new RaphNode(second, { id: 'second-node' })
    first.addNode(firstNode)
    second.addNode(secondNode)
    first.observeData(firstNode, 'shared.value', { phase: 'update' })
    second.observeData(secondNode, 'shared.value', { phase: 'update' })

    first.destroy()
    kernel.set('shared.value', 1)

    expect(firstCalls).toBe(0)
    expect(secondCalls).toBe(1)
    second.destroy()
  })
})
