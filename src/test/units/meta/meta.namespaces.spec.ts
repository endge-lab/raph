import { describe, expect, it } from 'vitest'

import { RaphKernel } from '@/domain/core/RaphKernel'

describe('пространства имён Meta-plane Raph', () => {
  it('изолирует namespaces одного канонического selector path', () => {
    const kernel = new RaphKernel()
    kernel.set('rows', [{ id: 7, value: 'A' }])
    kernel.meta.set('rows[id=$id].value', 'first', 1, { vars: { id: 7 } })
    kernel.meta.set('rows[id=7].value', 'second', 2)

    expect(kernel.meta.get('rows[id=7].value')).toEqual({ first: 1, second: 2 })
    expect(kernel.meta.get('rows[id=$id].value', 'first', { vars: { id: 7 } })).toBe(1)
  })
})
