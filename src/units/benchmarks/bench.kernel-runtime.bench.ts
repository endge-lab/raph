import { bench, describe } from 'vitest'
import { RaphKernel } from '@/domain/core/RaphKernel'
import { RaphNode } from '@/domain/core/RaphNode'
import { RaphApp } from '@/domain/core/RaphApp'
import { RaphLocalPhaseRuntime } from '@/domain/local/RaphLocalPhase'
import { RaphLocalPropertyRuntime } from '@/domain/local/RaphLocalProperty'
import { RaphPropagation } from '@/domain/local/local.types'
import { SchedulerType } from '@/domain/types/base.types'
import type { PhaseExecutorContext, PhaseName, RaphPhase } from '@/domain/types/phase.types'

type LocalProps = {
  value: number
}

describe('Raph kernel/runtime lane benchmarks', () => {
  const benchOptions = {
    iterations: 5,
    warmupIterations: 1,
    time: 10,
    warmupTime: 5,
  }

  bench('runtime isolation: 3 lanes / 30 phases / 30k nodes', () => {
    const fixture = createRuntimeIsolationFixture()
    fixture.kernel.transaction(() => {
      for (let i = 0; i < 100; i++) {
        fixture.kernel.set(`timeline.nodes.${i}.version`, i)
      }
    })
  }, benchOptions)

  bench('observeData: 100k observers / 10k writes', () => {
    const fixture = createObserveDataFixture()
    fixture.kernel.transaction(() => {
      for (let i = 0; i < 10_000; i++) {
        fixture.kernel.set(`items.${i}.0.version`, i)
      }
    })
  }, benchOptions)

  bench('local instant: 1m local writes without DataPath', () => {
    const { node, raph } = createLocalInstantFixture()
    const originalInvalidate = raph.invalidate.bind(raph)
    ;(raph as any).invalidate = () => {}
    for (let i = 0; i < 1_000_000; i++) {
      node.set('value', i)
    }
    ;(raph as any).invalidate = originalInvalidate
    raph.run()
  }, benchOptions)

  bench('transaction batch: 10k writes / 100 nodes / one lane', () => {
    const fixture = createTransactionFixture()
    fixture.kernel.transaction(() => {
      for (let i = 0; i < 10_000; i++) {
        fixture.kernel.set(`items.${i % 100}.value`, i)
      }
    })
  }, benchOptions)
})

function createRuntimeIsolationFixture() {
  const kernel = new RaphKernel()
  const runtimes = [
    kernel.createRuntime({ id: 'nova', scheduler: SchedulerType.Sync }),
    kernel.createRuntime({ id: 'low-code', scheduler: SchedulerType.Sync }),
    kernel.createRuntime({ id: 'other', scheduler: SchedulerType.Sync }),
  ]

  for (const runtime of runtimes) {
    const phases: Array<RaphPhase> = []
    for (let i = 0; i < 10; i++) {
      phases.push({
        name: `${runtime.id}-phase-${i}` as PhaseName,
        traversal: 'dirty-only',
        routes: [],
        each: (_ctx: PhaseExecutorContext) => {},
      })
    }
    runtime.definePhases(phases)

    for (let i = 0; i < 10_000; i++) {
      const node = new RaphNode(runtime, { id: `${runtime.id}-node-${i}` })
      runtime.addNode(node)
      if (runtime.id === 'nova' && i < 100) {
        runtime.observeData(node, `timeline.nodes.${i}.version`, {
          phase: `${runtime.id}-phase-0`,
        })
      }
    }
  }

  return { kernel }
}

function createObserveDataFixture() {
  const kernel = new RaphKernel()
  const runtime = kernel.createRuntime({ id: 'runtime', scheduler: SchedulerType.Sync })

  runtime.definePhases([
    {
      name: 'update' as PhaseName,
      traversal: 'dirty-only',
      routes: [],
      each: (_ctx: PhaseExecutorContext) => {},
    },
  ])

  for (let i = 0; i < 10_000; i++) {
    const node = new RaphNode(runtime, { id: `node-${i}` })
    runtime.addNode(node)
    for (let j = 0; j < 10; j++) {
      runtime.observeData(node, `items.${i}.${j}.version`, { phase: 'update' })
    }
  }

  return { kernel }
}

function createLocalInstantFixture() {
  const raph = new RaphApp<LocalProps>()
  const node = new RaphNode<LocalProps>(raph, { id: 'node' })

  raph.options({ scheduler: SchedulerType.Sync })
  raph.addLocalPhase(new RaphLocalPhaseRuntime<LocalProps>(
    'update',
    'dirty',
    () => {},
  ))
  raph.addLocalProperty(new RaphLocalPropertyRuntime<LocalProps, 'value'>(
    'value',
    'update',
    RaphPropagation.None,
    undefined,
    [],
    0,
  ))
  raph.init()
  raph.addNode(node)

  return { raph, node }
}

function createTransactionFixture() {
  const kernel = new RaphKernel()
  const runtime = kernel.createRuntime({ id: 'runtime', scheduler: SchedulerType.Sync })

  runtime.definePhases([
    {
      name: 'update' as PhaseName,
      traversal: 'dirty-only',
      routes: [],
      each: (_ctx: PhaseExecutorContext) => {},
    },
  ])

  for (let i = 0; i < 100; i++) {
    const node = new RaphNode(runtime, { id: `node-${i}` })
    runtime.addNode(node)
    runtime.observeData(node, `items.${i}.*`, { phase: 'update' })
  }

  return { kernel }
}
