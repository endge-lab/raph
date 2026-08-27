import { describe, expect, it } from 'vitest'
import { RaphRouter } from '@/domain/core/RaphRouter'

describe('raphRouter memory cleanup', () => {
  it('releases an untracked payload and its callback', async () => {
    const refs = registerThenRemovePayload()
    await collectGarbage()

    expect(refs.payload.deref()).toBeUndefined()
    expect(refs.callback.deref()).toBeUndefined()
  })

  it('does not retain unique-route lifecycle cycles beyond the memory budget', async () => {
    runUniqueRouteCycle(10_000, 0)
    await collectGarbage()
    const before = heapUsed()

    for (let cycle = 0; cycle < 3; cycle++) {
      runUniqueRouteCycle(10_000, 0)
    }

    await collectGarbage()
    const after = heapUsed()
    const budget = Math.max(before * 0.05, 2 * 1024 * 1024)
    expect(after - before).toBeLessThanOrEqual(budget)
  }, 30_000)
})

function registerThenRemovePayload(): {
  payload: WeakRef<object>
  callback: WeakRef<() => number>
} {
  const router = new RaphRouter<object>()
  let callback: (() => number) | null = () => 42
  let payload: { callback: () => number } | null = { callback }
  const refs = {
    payload: new WeakRef<object>(payload),
    callback: new WeakRef(callback),
  }
  router.add('rows.current.value', payload)
  router.match('rows.current.value')
  router.collectByPrefix('rows')
  router.removePayload(payload)
  payload = null
  callback = null
  return refs
}

function runUniqueRouteCycle(count: number, cycle: number): void {
  const router = new RaphRouter<object>()
  for (let index = 0; index < count; index++) {
    const payload = {}
    const path = `pages[cycle=${cycle}].rows[id=${index}].value`
    router.add(path, payload)
    router.match(path)
    router.removePayload(payload)
  }
  const internals = router as unknown as {
    _payloadMasks: Map<object, Set<string>>
    _matchCache: Map<string, unknown>
    _prefixCache: Map<string, unknown>
    _segCache: Map<string, unknown>
  }
  expect(internals._payloadMasks.size).toBe(0)
  expect(internals._matchCache.size).toBe(0)
  expect(internals._prefixCache.size).toBe(0)
  expect(internals._segCache.size).toBeLessThanOrEqual(20_000)
}

async function collectGarbage(): Promise<void> {
  const gc = (globalThis as { gc?: () => void }).gc
  for (let pass = 0; pass < 20; pass++) {
    if (typeof gc === 'function') {
      gc()
    }
    const pressure = new Array(10_000).fill(pass)
    if (pressure.length === 0) {
      throw new Error('unreachable')
    }
    await new Promise(resolve => setTimeout(resolve, 0))
  }
}

function heapUsed(): number {
  return (globalThis as any).process?.memoryUsage?.().heapUsed ?? 0
}
