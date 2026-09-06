import type { DataAdapter } from '@/domain/types/base.types'

import { describe, expect, it } from 'vitest'

import { RaphKernel } from '@/domain/core/RaphKernel'
import { DefaultDataAdapter } from '@/domain/entities/data-adapter'

describe('проверка существования data path', () => {
  it('defaultDataAdapter.has поддерживает undefined, indexes, selectors и vars', () => {
    const adapter = new DefaultDataAdapter({ rows: [{ id: 3, value: undefined }] })
    expect(adapter.has('rows[0].value')).toBe(true)
    expect(adapter.has('rows[id=$id].value', { vars: { id: 3 } })).toBe(true)
    expect(adapter.has('rows[id=4].value')).toBe(false)
  })

  it('kernel использует совместимый root fallback для внешнего adapter без has', () => {
    const base = new DefaultDataAdapter({ row: { value: undefined } })
    const adapter: DataAdapter = {
      root: () => base.root(),
      get: (path, options) => base.get(path, options),
      set: (path, value, options) => base.set(path, value, options),
      merge: (path, value, options) => base.merge(path, value, options),
      delete: (path, options) => base.delete(path, options),
      indexOf: (path, options) => base.indexOf(path, options),
    }
    const kernel = new RaphKernel({ adapter })
    expect(kernel.has('row.value')).toBe(true)
    expect(kernel.has('row.missing')).toBe(false)
  })
})
