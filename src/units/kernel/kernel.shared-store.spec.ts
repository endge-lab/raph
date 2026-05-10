import { describe, expect, it } from 'vitest'
import { RaphKernel } from '@/domain/core/RaphKernel'
import { SchedulerType } from '@/domain/types/base.types'

describe('RaphKernel shared store', () => {
  it('keeps data shared across runtimes and clears it only via kernel.clear()', () => {
    const kernel = new RaphKernel()
    const nova = kernel.createRuntime({ id: 'nova', scheduler: SchedulerType.Sync })
    const lowCode = kernel.createRuntime({ id: 'low-code', scheduler: SchedulerType.Sync })

    kernel.set('shared.value', 42, { invalidate: false })

    expect(nova.get('shared.value')).toBe(42)
    expect(lowCode.get('shared.value')).toBe(42)

    nova.destroy()

    expect(lowCode.get('shared.value')).toBe(42)

    kernel.clear()

    expect(lowCode.get('shared.value')).toBeUndefined()
  })
})
