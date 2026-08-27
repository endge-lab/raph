import type { PhaseName } from '@/domain/types/phase.types'
import { describe, expect, it } from 'vitest'
import { RaphApp } from '@/domain/core/RaphApp'
import { RaphNode } from '@/domain/core/RaphNode'
import { SchedulerType } from '@/domain/types/base.types'

describe('raphApp frame context overhead', () => {
  it('runs 10k sync frames with frame context under a small local budget', () => {
    const raph = new RaphApp()
    raph.options({ scheduler: SchedulerType.Sync })
    raph.definePhases([
      {
        name: 'phase' as PhaseName,
        traversal: 'dirty-only',
        routes: ['bench.*'],
        each: () => {},
      },
    ])
    const node = new RaphNode(raph)
    raph.addNode(node)
    raph.track(node, 'bench.*')

    const start = performance.now()
    for (let index = 0; index < 10_000; index += 1) {
      raph.set(`bench.${index}`, index)
    }
    const elapsed = performance.now() - start

    expect(raph.frame.frame).toBe(9_999)
    expect(elapsed).toBeLessThan(2_000)
  })
})
