import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RaphApp } from '@/domain/core/RaphApp'
import { SchedulerType } from '@/domain/types/base.types'

describe('raphApp loop leases', () => {
  let realRAF: typeof globalThis.requestAnimationFrame | undefined
  let realCAF: typeof globalThis.cancelAnimationFrame | undefined
  let rafSpy: ReturnType<typeof vi.fn>
  let cafSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    realRAF = globalThis.requestAnimationFrame
    realCAF = globalThis.cancelAnimationFrame
    rafSpy = vi.fn((cb: FrameRequestCallback) => {
      const id = setTimeout(() => cb(performance.now()), 16)
      return id as unknown as number
    })
    cafSpy = vi.fn((id: number) => clearTimeout(id as unknown as NodeJS.Timeout))
    globalThis.requestAnimationFrame = rafSpy as any
    globalThis.cancelAnimationFrame = cafSpy as any
  })

  afterEach(() => {
    globalThis.requestAnimationFrame = realRAF as any
    globalThis.cancelAnimationFrame = realCAF as any
    vi.useRealTimers()
  })

  it('starts continuous loop while at least one lease is active', () => {
    const raph = new RaphApp()
    raph.options({ scheduler: SchedulerType.AnimationFrame })

    const first = raph.acquireLoop('first')
    const second = raph.acquireLoop('second')

    expect(raph.loopEnabled).toBe(true)
    expect(rafSpy).toHaveBeenCalled()

    first.release()
    expect(raph.loopEnabled).toBe(true)

    second.release()
    expect(raph.loopEnabled).toBe(false)
    expect(cafSpy).toHaveBeenCalled()
  })

  it('does not stop a manually started loop when the last lease is released', () => {
    const raph = new RaphApp()
    raph.options({ scheduler: SchedulerType.AnimationFrame })

    raph.startLoop()
    const lease = raph.acquireLoop('motion')
    lease.release()

    expect(raph.loopEnabled).toBe(true)

    raph.stopLoop()
    expect(raph.loopEnabled).toBe(false)
  })
})
