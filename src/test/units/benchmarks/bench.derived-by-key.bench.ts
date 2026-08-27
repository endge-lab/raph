import { afterAll, bench, describe } from 'vitest'
import { RaphKernel } from '@/domain/core/RaphKernel'
import { collectionByKey } from '@/domain/derived/strategies/collection-by-key'
import { SchedulerType } from '@/domain/types/base.types'

describe('derived collectionByKey benchmarks', () => {
  const size = stressSize(10_000, 1_000_000)
  const bursts = isStress() ? [1, 100, 10_000] : [1, 10, 100, 1_000]
  const fixtures: Array<ReturnType<typeof fixture>> = []
  const incremental = fixture(size, true)
  const complete = fixture(size, false)
  fixtures.push(incremental, complete)

  for (const updates of bursts) {
    bench(`byKey ${updates} updates / ${size} rows`, () => {
      mutate(incremental.kernel, updates)
    })

    bench(`full ${updates} updates / ${size} rows`, () => {
      mutate(complete.kernel, updates)
    })
  }

  if (!isStress()) {
    const heavyIncremental = fixture(size, true, true)
    const heavyFull = fixture(size, false, true)
    fixtures.push(heavyIncremental, heavyFull)
    bench(`byKey CPU-heavy single update / ${size} rows`, () => {
      mutate(heavyIncremental.kernel, 1)
    })
    bench(`full CPU-heavy single update / ${size} rows`, () => {
      mutate(heavyFull.kernel, 1)
    })
  }

  afterAll(() => fixtures.forEach(({ runtime }) => runtime.destroy()))
})

function mutate(kernel: RaphKernel, updates: number) {
  kernel.transaction(() => {
    for (let index = 0; index < updates; index++) {
      kernel.set(`source[id=${index}].value`, index + 1)
    }
  })
}

function fixture(size: number, incremental: boolean, cpuHeavy = false) {
  const kernel = new RaphKernel()
  const runtime = kernel.createRuntime({ scheduler: SchedulerType.Sync })
  runtime.init()
  kernel.set('source', Array.from({ length: size }, (_, id) => ({ id, value: id })))
  runtime.derive({
    from: 'source',
    to: 'target',
    strategy: incremental ? collectionByKey('id') : undefined,
    compute: (rows: Array<{ id: number, value: number }>) => rows.map((row) => {
      let score = row.value * 2
      if (cpuHeavy) {
        for (let iteration = 0; iteration < 250; iteration++) {
          score = Math.imul(score ^ iteration, 2654435761) >>> 0
        }
      }
      return { id: row.id, doubled: score }
    }),
  })
  return { kernel, runtime }
}

function stressSize(normal: number, stress: number): number {
  return isStress() ? stress : normal
}

function isStress(): boolean {
  return (globalThis as any).process?.env?.RAPH_DERIVED_STRESS === '1'
}
