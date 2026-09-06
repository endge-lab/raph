import { bench, describe } from 'vitest'

import { RaphKernel } from '@/domain/core/RaphKernel'

describe('бенчмарки CRUD Meta-plane Raph', () => {
  const options = { iterations: 5, warmupIterations: 1, time: 10, warmupTime: 5 }

  bench('100k exact операций Meta set/get/has', () => {
    const kernel = new RaphKernel()
    kernel.set('rows', Array.from({ length: 100_000 }, (_, id) => ({ id, value: id })))
    kernel.transaction(() => {
      for (let id = 0; id < 100_000; id++) {
        kernel.meta.set(`rows[${id}].value`, 'bench', id, { invalidate: false })
      }
    })
    for (let id = 0; id < 100_000; id++) {
      kernel.meta.get(`rows[${id}].value`, 'bench')
      kernel.meta.has(`rows[${id}].value`, 'bench')
    }
  }, options)

  bench('100k чтений selector Meta с vars', () => {
    const kernel = new RaphKernel()
    kernel.set('rows', Array.from({ length: 100_000 }, (_, id) => ({ id, value: id })))
    kernel.meta.set('rows[id=99999].value', 'bench', true)
    for (let index = 0; index < 100_000; index++) {
      kernel.meta.has('rows[id=$id].value', 'bench', { vars: { id: 99_999 } })
    }
  }, options)
})
