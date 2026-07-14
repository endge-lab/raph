import { bench, describe } from 'vitest'
import { RaphKernel } from '@/domain/core/RaphKernel'
import { SchedulerType } from '@/domain/types/base.types'

describe('derived graph benchmarks', () => {
  bench('chain depth 20 stabilization', () => {
    const kernel = new RaphKernel()
    const runtime = kernel.createRuntime({ scheduler: SchedulerType.Sync })
    runtime.init()
    kernel.set('value.v0', 0)
    for (let index = 0; index < 20; index++) {
      runtime.derive({
        id: `chain-${index}`,
        from: `value.v${index}`,
        to: `value.v${index + 1}`,
        compute: value => Number(value) + 1,
      })
    }
    kernel.set('value.v0', 1)
    runtime.destroy()
  })

  bench('fan-out 100 stabilization', () => {
    const kernel = new RaphKernel()
    const runtime = kernel.createRuntime({ scheduler: SchedulerType.Sync })
    runtime.init()
    kernel.set('source', 1)
    for (let index = 0; index < 100; index++) {
      runtime.derive({
        id: `fan-${index}`, from: 'source', to: `targets.t${index}`,
        compute: value => Number(value) + index,
      })
    }
    kernel.set('source', 2)
    runtime.destroy()
  })
})
