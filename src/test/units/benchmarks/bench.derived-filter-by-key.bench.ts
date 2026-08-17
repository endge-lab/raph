import { afterAll, bench, describe } from 'vitest'

import { RaphKernel } from '@/domain/core/RaphKernel'
import { filterByKey } from '@/domain/derived/strategies/filter-by-key'
import { SchedulerType } from '@/domain/types/base.types'

describe('derived filterByKey benchmarks', () => {
  const size = stressSize(10_000, 1_000_000)
  const bursts = isStress() ? [1, 2_000, 10_000] : [1, 100, 2_000]
  const fixtures: FilterFixture[] = []
  const incrementalChurn = fixture(size, true, 'membership-churn')
  const fullChurn = fixture(size, false, 'membership-churn')
  const incrementalRejected = fixture(size, true, 'always-rejected')
  const fullRejected = fixture(size, false, 'always-rejected')
  fixtures.push(incrementalChurn, fullChurn, incrementalRejected, fullRejected)

  for (const updates of bursts) {
    bench(`filterByKey membership churn: ${updates} updates / ${size} rows`, () => {
      mutate(incrementalChurn, updates)
    })

    bench(`full filter membership churn: ${updates} updates / ${size} rows`, () => {
      mutate(fullChurn, updates)
    })
  }

  bench(`filterByKey rejected burst: 2k updates / ${size} rows`, () => {
    mutate(incrementalRejected, Math.min(2_000, size))
  })

  bench(`full filter rejected burst: 2k updates / ${size} rows`, () => {
    mutate(fullRejected, Math.min(2_000, size))
  })

  if (!isStress()) {
    const heavyIncremental = fixture(size, true, 'cpu-heavy')
    const heavyFull = fixture(size, false, 'cpu-heavy')
    fixtures.push(heavyIncremental, heavyFull)

    bench(`filterByKey CPU-heavy single update / ${size} rows`, () => {
      mutate(heavyIncremental, 1)
    })

    bench(`full CPU-heavy single update / ${size} rows`, () => {
      mutate(heavyFull, 1)
    })
  }

  afterAll(() => fixtures.forEach(({ runtime }) => runtime.destroy()))
})

type Scenario = 'membership-churn' | 'always-rejected' | 'cpu-heavy'

interface FilterFixture {
  kernel: RaphKernel
  runtime: ReturnType<RaphKernel['createRuntime']>
  epoch: number
}

function fixture(size: number, incremental: boolean, scenario: Scenario): FilterFixture {
  const kernel = new RaphKernel()
  const runtime = kernel.createRuntime({ scheduler: SchedulerType.Sync })
  runtime.init()
  kernel.set('source', Array.from({ length: size }, (_, id) => ({
    id,
    value: id,
    visible: scenario !== 'always-rejected',
  })))
  runtime.derive({
    from: 'source',
    to: 'target',
    strategy: incremental ? filterByKey('id') : undefined,
    compute: (rows: Array<{ id: number, value: number, visible: boolean }>) => rows
      .filter((row) => {
        if (!row.visible)
          return false
        return scenario === 'membership-churn' ? row.value % 2 === 0 : true
      })
      .map((row) => {
        let score = row.value * 2
        if (scenario === 'cpu-heavy') {
          for (let iteration = 0; iteration < 250; iteration++)
            score = Math.imul(score ^ iteration, 2654435761) >>> 0
        }
        return { id: row.id, score }
      }),
  })
  return { kernel, runtime, epoch: 0 }
}

function mutate(input: FilterFixture, updates: number): void {
  const epoch = input.epoch++
  input.kernel.transaction(() => {
    for (let id = 0; id < updates; id++)
      input.kernel.set(`source[id=${id}].value`, id + epoch + 1)
  })
}

function stressSize(normal: number, stress: number): number {
  return isStress() ? stress : normal
}

function isStress(): boolean {
  return (globalThis as any).process?.env?.RAPH_DERIVED_STRESS === '1'
}
