import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RaphApp } from '@/domain/core/RaphApp'
import { RaphNode } from '@/domain/core/RaphNode'
import { SchedulerType } from '@/domain/types/base.types'
import type { PhaseExecutorContext, PhaseName } from '@/domain/types/phase.types'

describe('RaphApp frame context', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('passes the same frame context to each and all executors', () => {
    const raph = new RaphApp()
    raph.options({ scheduler: SchedulerType.Sync })

    const eachFrames: number[] = []
    const allFrames: number[] = []

    raph.definePhases([
      {
        name: 'each-phase' as PhaseName,
        traversal: 'dirty-only',
        routes: ['items.*'],
        each: (ctx: PhaseExecutorContext) => {
          eachFrames.push(ctx.frame.frame)
        },
      },
      {
        name: 'all-phase' as PhaseName,
        traversal: 'dirty-only',
        routes: ['items.*'],
        all: (ctxs: PhaseExecutorContext[]) => {
          allFrames.push(...ctxs.map(ctx => ctx.frame.frame))
        },
      },
    ])

    const node = new RaphNode(raph, { id: 'tracked' })
    raph.addNode(node)
    raph.track(node, 'items.*')

    raph.set('items.a', 1)

    expect(eachFrames).toEqual([0])
    expect(allFrames).toEqual([0])
    expect(raph.frame.frame).toBe(0)
    expect(raph.frame.delta).toBe(0)
  })

  it('calculates delta, elapsed and clamps large frame gaps', () => {
    const raph = new RaphApp()
    raph.options({ scheduler: SchedulerType.Sync })

    const frames: Array<{ delta: number; elapsed: number; frame: number }> = []
    raph.definePhases([
      {
        name: 'phase' as PhaseName,
        traversal: 'dirty-only',
        routes: ['tick.*'],
        each: ctx => frames.push({
          delta: ctx.frame.delta,
          elapsed: ctx.frame.elapsed,
          frame: ctx.frame.frame,
        }),
      },
    ])

    const node = new RaphNode(raph)
    raph.addNode(node)
    raph.track(node, 'tick.*')

    raph.set('tick.a', 1)
    vi.advanceTimersByTime(40)
    raph.set('tick.b', 2)
    vi.advanceTimersByTime(460)
    raph.set('tick.c', 3)

    expect(frames).toEqual([
      { delta: 0, elapsed: 0, frame: 0 },
      { delta: 40, elapsed: 40, frame: 1 },
      { delta: 100, elapsed: 500, frame: 2 },
    ])
  })
})
