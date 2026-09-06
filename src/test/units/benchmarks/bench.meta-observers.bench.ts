import type { PhaseExecutorContext, PhaseName } from '@/domain/types/phase.types'

import { bench, describe } from 'vitest'

import { RaphKernel } from '@/domain/core/RaphKernel'
import { RaphNode } from '@/domain/core/RaphNode'
import { SchedulerType } from '@/domain/types/base.types'

describe('бенчмарки observers Meta-plane Raph', () => {
  const options = { iterations: 5, warmupIterations: 1, time: 10, warmupTime: 5 }

  bench('100k Meta observers / 10k mutations', () => {
    const kernel = new RaphKernel()
    const runtime = kernel.createRuntime({ scheduler: SchedulerType.Sync })
    runtime.definePhases([{
      name: 'render' as PhaseName,
      traversal: 'dirty-only',
      routes: [],
      each: (_context: PhaseExecutorContext) => {},
    }])
    kernel.set('items', Array.from({ length: 10_000 }, (_, id) => ({ id, value: id })))
    for (let id = 0; id < 10_000; id++) {
      const node = new RaphNode(runtime, { id: `node-${id}` })
      runtime.addNode(node)
      for (let index = 0; index < 10; index++) {
        runtime.observeMeta(node, `items[${id}].value`, { phase: 'render', namespace: `n${index}` })
      }
    }
    kernel.transaction(() => {
      for (let id = 0; id < 10_000; id++) {
        kernel.meta.set(`items[${id}].value`, 'n0', id, { invalidate: false })
      }
    })
    runtime.destroy()
  }, options)

  bench('transaction из 10k пар Data+Meta', () => {
    const kernel = new RaphKernel()
    kernel.set('items', Array.from({ length: 10_000 }, (_, id) => ({ id, value: id })))
    kernel.transaction(() => {
      for (let id = 0; id < 10_000; id++) {
        kernel.set(`items[${id}].value`, id + 1, { invalidate: false })
        kernel.meta.set(`items[${id}].value`, 'bench', id, { invalidate: false })
      }
    })
  }, options)
})
