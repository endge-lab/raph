import type { PhaseName } from '@/domain/types/phase.types'

import { describe, expect, it } from 'vitest'

import { RaphKernel } from '@/domain/core/RaphKernel'
import { RaphNode } from '@/domain/core/RaphNode'
import { SchedulerType } from '@/domain/types/base.types'

describe('интеграция lifecycle runtime и Meta-plane', () => {
  it('destroy снимает Meta observers, но сохраняет shared metadata', () => {
    const kernel = new RaphKernel()
    kernel.set('value', 1)
    kernel.meta.set('value', 'test', true)
    const runtime = kernel.createRuntime({ scheduler: SchedulerType.Sync })
    const node = new RaphNode(runtime, { id: 'node' })
    let runs = 0
    runtime.definePhases([{ name: 'render' as PhaseName, traversal: 'dirty-only', routes: [], each: () => runs++ }])
    runtime.addNode(node)
    runtime.observeMeta(node, 'value', { phase: 'render' })

    runtime.destroy()
    kernel.meta.set('value', 'test', false)

    expect(runs).toBe(0)
    expect(kernel.meta.get('value', 'test')).toBe(false)
  })
})
