import { describe, expect, it } from 'vitest'

import { RaphKernel } from '@/domain/core/RaphKernel'

describe('изоляция Meta-plane между kernels', () => {
  it('не разделяет metadata разных owner universes', () => {
    const first = new RaphKernel()
    const second = new RaphKernel()
    first.set('value', 1)
    second.set('value', 1)
    first.meta.set('value', 'test', true)
    expect(second.meta.has('value')).toBe(false)
  })
})
