import { bench, describe } from 'vitest'

import { RaphKernel } from '@/domain/core/RaphKernel'

describe('бенчмарки lifecycle Meta-plane Raph', () => {
  const options = { iterations: 5, warmupIterations: 1, time: 10, warmupTime: 5 }

  bench('удаление Meta-поддерева из 100k entries', () => {
    const kernel = new RaphKernel()
    kernel.set('rows', Array.from({ length: 100_000 }, (_, id) => ({ id, value: id })))
    kernel.transaction(() => {
      for (let id = 0; id < 100_000; id++) {
        kernel.meta.set(`rows[${id}].value`, 'bench', id, { invalidate: false })
      }
    })
    kernel.delete('rows', { invalidate: false })
  }, options)

  bench('10k Data writes с пустым Meta registry', () => {
    const kernel = new RaphKernel()
    kernel.transaction(() => {
      for (let index = 0; index < 10_000; index++) {
        kernel.set(`values.${index}`, index, { invalidate: false })
      }
    })
  }, options)

  bench('очистка пустого Meta registry 100k раз', () => {
    const kernel = new RaphKernel()
    for (let index = 0; index < 100_000; index++) {
      kernel.clear()
    }
  }, options)
})
