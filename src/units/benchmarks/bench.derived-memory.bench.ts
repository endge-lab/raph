import { afterAll, bench, describe } from 'vitest'
import { RaphKernel } from '@/domain/core/RaphKernel'
import { SchedulerType } from '@/domain/types/base.types'

describe('derived empty-registry overhead', () => {
  const baseline = fixture(false)
  const initialized = fixture(true)

  bench('10k mutations without derived manager', () => {
    for (let index = 0; index < 10_000; index++)
      baseline.kernel.set(`data.k${index}`, index, { invalidate: false })
  })

  bench('10k mutations after disposed derived manager', () => {
    for (let index = 0; index < 10_000; index++)
      initialized.kernel.set(`data.k${index}`, index, { invalidate: false })
  })

  afterAll(() => {
    baseline.runtime.destroy()
    initialized.runtime.destroy()
  })
})

function fixture(initializeManager: boolean) {
  const kernel = new RaphKernel()
  const runtime = kernel.createRuntime({ scheduler: SchedulerType.Sync })
  runtime.init()
  if (initializeManager)
    runtime.derive({ from: 'source', to: 'target', immediate: false, compute: value => value }).dispose()
  return { kernel, runtime }
}
