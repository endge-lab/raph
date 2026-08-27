import { bench, describe } from 'vitest'
import { RaphRouter } from '@/domain/core/RaphRouter'

describe('router lifecycle benchmarks', () => {
  bench('cold match / 10k unique routes', () => {
    const router = createRouter(10_000)
    for (let index = 0; index < 10_000; index++) {
      router.match(`rows[id=${index}].value`)
    }
  }, { iterations: 5, warmupIterations: 1 })

  bench('warm match / 10k cached routes', () => {
    const router = createRouter(10_000)
    for (let index = 0; index < 10_000; index++) {
      router.match(`rows[id=${index}].value`)
    }
    for (let index = 0; index < 10_000; index++) {
      router.match(`rows[id=${index}].value`)
    }
  }, { iterations: 5, warmupIterations: 1 })

  bench('track 1m duplicate registrations', () => {
    const router = new RaphRouter<object>()
    const payload = {}
    for (let index = 0; index < 1_000_000; index++) {
      router.add('rows.current.value', payload)
    }
  }, { iterations: 5, warmupIterations: 1 })

  bench('partial untrack / 10k routes', () => {
    const router = new RaphRouter<object>()
    const payload = {}
    for (let index = 0; index < 10_000; index++) {
      router.add(`rows[id=${index}].value`, payload)
    }
    for (let index = 0; index < 5_000; index++) {
      router.remove(`rows[id=${index}].value`, payload)
    }
  }, { iterations: 5, warmupIterations: 1 })

  bench('full untrack / 10k routes', () => {
    const router = new RaphRouter<object>()
    const payload = {}
    for (let index = 0; index < 10_000; index++) {
      router.add(`rows[id=${index}].value`, payload)
    }
    router.removePayload(payload)
  }, { iterations: 5, warmupIterations: 1 })

  bench('create/destroy 10k unique-route payloads', () => {
    const router = new RaphRouter<object>()
    for (let index = 0; index < 10_000; index++) {
      const payload = {}
      router.add(`runtime[id=${index}].value`, payload)
      router.removePayload(payload)
    }
  }, { iterations: 5, warmupIterations: 1 })

  bench('invalidate cache and rebuild branch / 10k cycles', () => {
    const router = new RaphRouter<object>()
    const payload = {}
    for (let index = 0; index < 10_000; index++) {
      const path = `runtime.current.value${index % 10}`
      router.add(path, payload)
      router.match(path)
      router.remove(path, payload)
    }
  }, { iterations: 5, warmupIterations: 1 })
})

function createRouter(count: number): RaphRouter<object> {
  const router = new RaphRouter<object>()
  for (let index = 0; index < count; index++) {
    router.add(`rows[id=${index}].value`, {})
  }
  return router
}
