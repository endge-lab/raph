import { describe, expect, it } from 'vitest'

import { RaphKernel, RaphNode, RaphSchedulerType } from '@/main'

describe('raphNode reparent', () => {
  it('removes the previous graph edge when a node changes parent', () => {
    const runtime = new RaphKernel().createRuntime({
      id: 'node-reparent',
      scheduler: RaphSchedulerType.Sync,
    })
    const first = new RaphNode(runtime, { id: 'first' })
    const second = new RaphNode(runtime, { id: 'second' })
    const child = new RaphNode(runtime, { id: 'child' })
    runtime.addNode(first)
    runtime.addNode(second)
    first.addChild(child, { invalidate: false })

    second.addChild(child, { invalidate: false })

    expect(child.parent).toBe(second)
    expect(first.children).not.toContain(child)
    expect([...runtime.graph.parentsOf(child)]).toEqual([second])
  })
})
