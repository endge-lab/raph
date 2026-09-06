import { describe, expect, it } from 'vitest'

import { RaphKernel } from '@/domain/core/RaphKernel'

describe('ошибки адресации Meta-plane Raph', () => {
  it('отклоняет пустой namespace и wildcard writes', () => {
    const kernel = new RaphKernel()
    kernel.set('rows', [{ value: 1 }])

    expect(() => kernel.meta.set('rows[0].value', '', true)).toThrow('namespace must not be empty')
    expect(() => kernel.meta.set('rows[*].value', 'validation', true)).toThrow('wildcard paths are read-only')
    expect(() => kernel.meta.watch('rows[*].value', () => {})).toThrow('watch requires a runtime-bound Meta facade')
  })
})
