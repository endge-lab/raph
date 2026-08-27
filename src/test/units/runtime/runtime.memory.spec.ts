import { describe, expect, it } from 'vitest'
import { RaphKernel } from '@/domain/core/RaphKernel'
import { RaphNode } from '@/domain/core/RaphNode'

describe('raph runtime memory cleanup', () => {
  it('releases a removed node and its observer callback', async () => {
    const refs = createAndRemoveNode()
    await collectGarbage()

    expect(refs.node.deref()).toBeUndefined()
    expect(refs.callback.deref()).toBeUndefined()
  })
})

function createAndRemoveNode(): {
  node: WeakRef<RaphNode>
  callback: WeakRef<() => void>
} {
  const kernel = new RaphKernel()
  const runtime = kernel.createRuntime({ id: 'memory-runtime' })
  let callback: (() => void) | null = () => undefined
  let node: RaphNode | null = new RaphNode(runtime, {
    id: 'memory-node',
    meta: { callback },
  })
  const refs = {
    node: new WeakRef(node),
    callback: new WeakRef(callback),
  }
  runtime.addNode(node)
  runtime.observeData(node, 'memory.rows.value', {})
  node.remove()
  node = null
  callback = null
  runtime.destroy()
  return refs
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
