import type { RaphMetaWatch } from '@/domain/reactivity/RaphMetaWatch'

import type { PhaseExecutorContext, PhaseName } from '@/domain/types/phase.types'

import { describe, expect, it } from 'vitest'
import { RaphKernel } from '@/domain/core/RaphKernel'
import { SchedulerType } from '@/domain/types/base.types'

describe('очистка памяти Meta-plane Raph', () => {
  it('не удерживает удалённое Meta value', async () => {
    const weak = registerThenDeleteMetaValue()
    await collectGarbage()
    expect(weak.deref()).toBeUndefined()
  })

  it('не удерживает callback после dispose Meta watch и runtime', async () => {
    const weak = registerThenDisposeMetaWatch()
    await collectGarbage()
    expect(weak.deref()).toBeUndefined()
  })
})

function registerThenDeleteMetaValue(): WeakRef<object> {
  const kernel = new RaphKernel()
  kernel.set('value', 1)
  let value: { payload: number[] } | null = { payload: Array.from({ length: 10_000 }).fill(1) }
  const weak = new WeakRef(value)
  kernel.meta.set('value', 'test', value)
  kernel.delete('value')
  value = null
  return weak
}

function registerThenDisposeMetaWatch(): WeakRef<object> {
  const kernel = new RaphKernel()
  const runtime = kernel.createRuntime({ scheduler: SchedulerType.Sync })
  runtime.definePhases([{
    name: '__watch' as PhaseName,
    traversal: 'dirty-only',
    routes: [],
    each: (context: PhaseExecutorContext) => (context.node as RaphMetaWatch).run(context),
  }])
  let captured: { payload: number[] } | null = { payload: Array.from({ length: 10_000 }).fill(1) }
  const weak = new WeakRef(captured)
  const callback = (() => captured?.payload.length) as () => void
  const dispose = runtime.meta.watch('value', callback)
  dispose()
  runtime.destroy()
  captured = null
  return weak
}

async function collectGarbage(): Promise<void> {
  const gc = (globalThis as { gc?: () => void }).gc
  for (let pass = 0; pass < 20; pass++) {
    if (typeof gc === 'function') {
      gc()
    }
    const pressure = Array.from({ length: 10_000 }).fill(pass)
    if (!pressure.length) {
      throw new Error('unreachable')
    }
    await new Promise(resolve => setTimeout(resolve, 0))
  }
}
