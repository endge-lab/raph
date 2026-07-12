import { afterAll, bench, describe } from 'vitest'
import { RaphKernel } from '@/domain/core/RaphKernel'
import { SchedulerType } from '@/domain/types/base.types'

describe('derived full benchmarks', () => {
  const size = stressSize(1_000, 1_000_000)
  const rows = Array.from({ length: size }, (_, id) => ({ id, value: id % 100, nested: { active: id % 2 === 0 } }))
  const derived = fixture(rows)
  derived.runtime.derive({
    from: 'source', to: 'target',
    compute: (source: typeof rows) => source.map(row => ({ id: row.id, score: row.value * 2 })),
  })
  const manual = new RaphKernel()
  manual.set('source', rows)

  bench(`full map ${size} rows`, () => {
    derived.kernel.notify('source')
  })

  bench(`manual map + set ${size} rows`, () => {
    manual.set('target', rows.map(row => ({ id: row.id, score: row.value * 2 })))
  })

  afterAll(() => derived.runtime.destroy())
})

function fixture(rows: unknown[]) {
  const kernel = new RaphKernel()
  const runtime = kernel.createRuntime({ scheduler: SchedulerType.Sync })
  runtime.init()
  kernel.set('source', rows)
  return { kernel, runtime }
}

function stressSize(normal: number, stress: number): number {
  return (globalThis as any).process?.env?.RAPH_DERIVED_STRESS === '1' ? stress : normal
}
