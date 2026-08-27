import { bench, describe } from 'vitest'
import { RaphKernel } from '@/domain/core/RaphKernel'
import { SchedulerType } from '@/domain/types/base.types'

describe('derived lifecycle benchmarks', () => {
  bench('register/dispose 10k handles', () => {
    const kernel = new RaphKernel()
    const runtime = kernel.createRuntime({ scheduler: SchedulerType.Sync })
    runtime.init()
    for (let index = 0; index < 10_000; index++) {
      runtime.derive({
        id: `lifecycle-${index}`,
        from: 'source',
        to: `target.t${index}`,
        immediate: false,
        compute: value => value,
      }).dispose()
    }
    runtime.destroy()
  })
})
