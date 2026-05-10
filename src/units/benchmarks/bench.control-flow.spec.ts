import { describe, expect, it } from 'vitest'
import { RaphApp } from '@/domain/core/RaphApp'
import { RaphNode } from '@/domain/core/RaphNode'
import { SchedulerType } from '@/domain/types/base.types'

/**
 * Bench control flow.
 * Проверяем не только скорость, но и то, что batching/callback dispatch
 * работают корректно под нагрузкой.
 */
describe('bench.control-flow', () => {
  it('flushes 1_000 control-flow notifications for one subscription', () => {
    const raph = new RaphApp()
    raph.options({ scheduler: SchedulerType.Sync })

    const owner = new RaphNode(raph, { id: 'bench-owner-single' })
    raph.addNode(owner)

    let calls = 0
    let eventsSeen = 0

    raph.subscribe(owner, 'bench.single.*', ({ events }) => {
      calls++
      eventsSeen += events.length
    })

    const ITER = 1_000
    const t0 = performance.now()

    for (let i = 0; i < ITER; i++) {
      raph.set(`bench.single.k${i}`, i, { invalidate: false })
      raph.run()
    }

    const totalMs = performance.now() - t0

    expect(calls).toBe(ITER)
    expect(eventsSeen).toBe(ITER)

    console.info(
      `[bench.control-flow single x${ITER}] total=${totalMs.toFixed(3)}ms`,
    )
  })

  it('batches 1_000 notifications and fanouts them to many subscriptions', () => {
    const raph = new RaphApp()
    raph.options({ scheduler: SchedulerType.Sync })

    const SUBS = 250
    const ITER = 1_000
    let calls = 0
    let eventsSeen = 0

    for (let i = 0; i < SUBS; i++) {
      const owner = new RaphNode(raph, { id: `bench-owner-${i}` })
      raph.addNode(owner)
      raph.subscribe(owner, 'bench.multi.*', ({ events }) => {
        calls++
        eventsSeen += events.length
      })
    }

    const t0 = performance.now()

    for (let i = 0; i < ITER; i++) {
      raph.set(`bench.multi.k${i}`, i, { invalidate: false })
    }

    raph.run()

    const totalMs = performance.now() - t0

    expect(calls).toBe(SUBS)
    expect(eventsSeen).toBe(SUBS * ITER)

    console.info(
      `[bench.control-flow fanout subs=${SUBS} events=${ITER}] total=${totalMs.toFixed(
        3,
      )}ms`,
    )
  })
})
