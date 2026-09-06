import { describe, expect, it } from 'vitest'

import { Raph } from '@/domain/core/Raph'
import { RaphKernel } from '@/domain/core/RaphKernel'
import { SchedulerType } from '@/domain/types/base.types'

describe('crud пользовательской metadata Raph', () => {
  it('читает, устанавливает, объединяет и удаляет exact namespace', () => {
    const kernel = new RaphKernel()
    kernel.set('rows[id=42].carrier', 'SU')

    kernel.meta.set('rows[id=$id].carrier', 'aodb.optimistic', { status: 'waiting' }, { vars: { id: 42 } })
    kernel.meta.set('rows[id=42].carrier', 'validation', { valid: true })
    kernel.meta.merge('rows[id=42].carrier', 'aodb.optimistic', { attempts: 1 })

    expect(kernel.meta.has('rows[id=42].carrier', 'aodb.optimistic')).toBe(true)
    expect(kernel.meta.get('rows[id=42].carrier', 'aodb.optimistic')).toEqual({ status: 'waiting', attempts: 1 })
    expect(kernel.meta.get('rows[id=42].carrier')).toEqual({
      'aodb.optimistic': { status: 'waiting', attempts: 1 },
      'validation': { valid: true },
    })

    kernel.meta.delete('rows[id=42].carrier', 'aodb.optimistic')
    expect(kernel.meta.has('rows[id=42].carrier', 'aodb.optimistic')).toBe(false)
    expect(kernel.meta.get('rows[id=42].carrier')).toEqual({ validation: { valid: true } })

    kernel.meta.delete('rows[id=42].carrier')
    expect(kernel.meta.has('rows[id=42].carrier')).toBe(false)

    expect(kernel.meta.get('rows[id=404].carrier')).toBeUndefined()
    expect(kernel.meta.has('rows[id=404].carrier')).toBe(false)
    expect(() => kernel.meta.delete('rows[id=404].carrier')).not.toThrow()
    expect(() => kernel.meta.delete('rows[id=42].carrier', 'missing')).not.toThrow()
  })

  it('заменяет scalar Meta при merge и не удаляет metadata descendants через exact delete', () => {
    const kernel = new RaphKernel()
    kernel.set('row', { value: 1 })
    kernel.meta.set('row.value', 'state', 'waiting')
    kernel.meta.merge('row.value', 'state', { status: 'ready' })

    expect(kernel.meta.get('row.value', 'state')).toEqual({ status: 'ready' })
    kernel.meta.delete('row')
    expect(kernel.meta.get('row.value', 'state')).toEqual({ status: 'ready' })
  })

  it('сохраняет ссылочную семантику и отличает undefined owner от отсутствующего пути', () => {
    const kernel = new RaphKernel()
    const value = { status: 'waiting' }
    kernel.set('row.optional', undefined)
    kernel.meta.set('row.optional', 'optimistic', value)

    expect(kernel.has('row.optional')).toBe(true)
    expect(kernel.meta.get('row.optional', 'optimistic')).toBe(value)
    expect(() => kernel.meta.set('row.missing', 'optimistic', value)).toThrow('Owner data path does not exist')
  })

  it('публикует has и Meta watch через статический фасад default runtime', () => {
    Raph.options({ scheduler: SchedulerType.Sync })
    Raph.set('__meta_public.value', undefined)
    const events: string[] = []
    const dispose = Raph.meta.watch(['__meta_public.value'], ({ events: batch }) => {
      events.push(...batch.map(event => `${event.kind}:${event.namespace}`))
    })

    expect(Raph.has('__meta_public.value')).toBe(true)
    Raph.meta.set('__meta_public.value', 'test', true)
    expect(Raph.meta.get('__meta_public.value', 'test')).toBe(true)
    expect(events).toEqual(['set:test'])

    dispose()
    Raph.delete('__meta_public')
    Raph.app.reset()
  })
})
