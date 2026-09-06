import { describe, expect, it } from 'vitest'

import { RaphKernel } from '@/domain/core/RaphKernel'
import { RaphNode } from '@/domain/core/RaphNode'
import { DefaultDataAdapter } from '@/domain/entities/data-adapter'

describe('жизненный цикл Meta-plane относительно owner data', () => {
  it('сохраняет exact Meta при смене значения и удаляет её вместе с leaf или parent', () => {
    const kernel = new RaphKernel()
    kernel.set('row', { value: 'A', nested: { flag: true } })
    kernel.meta.set('row.value', 'optimistic', { status: 'waiting' })
    kernel.meta.set('row.nested.flag', 'validation', { valid: true })

    kernel.set('row.value', 'B')
    expect(kernel.meta.has('row.value', 'optimistic')).toBe(true)

    kernel.delete('row.nested')
    expect(kernel.meta.has('row.nested.flag', 'validation')).toBe(false)
    expect(kernel.meta.has('row.value', 'optimistic')).toBe(true)

    kernel.delete('row')
    expect(kernel.meta.has('row.value', 'optimistic')).toBe(false)
  })

  it('чистит исчезнувших descendants после структурной замены и не восстанавливает их при повторном создании', () => {
    const kernel = new RaphKernel()
    kernel.set('row', { nested: { value: 1 } })
    kernel.meta.set('row.nested.value', 'validation', true)

    kernel.set('row', { other: true })
    expect(kernel.meta.has('row.nested.value', 'validation')).toBe(false)
    kernel.set('row.nested.value', 2)
    expect(kernel.meta.has('row.nested.value', 'validation')).toBe(false)
  })

  it('очищает Meta при замене adapter и kernel.clear', () => {
    const kernel = new RaphKernel()
    kernel.set('value', 1)
    kernel.meta.set('value', 'test', true)
    kernel.setDataAdapter(new DefaultDataAdapter({ value: 2 }))
    expect(kernel.meta.has('value')).toBe(false)

    kernel.meta.set('value', 'test', true)
    kernel.clear()
    expect(kernel.meta.has('value')).toBe(false)
    expect(kernel.has('value')).toBe(false)
  })

  it('каскадно очищает Meta при удалении data root', () => {
    const kernel = new RaphKernel()
    kernel.set('row.value', 1)
    kernel.meta.set('row.value', 'test', true)

    kernel.delete('')

    expect(kernel.meta.has('row.value', 'test')).toBe(false)
    expect(kernel.has('row')).toBe(false)
  })

  it('удаляет Meta исчезнувшихся позиционных owners после array splice', () => {
    const kernel = new RaphKernel({
      adapter: new DefaultDataAdapter({}, { arrayDelete: 'splice' }),
    })
    kernel.set('rows', [{ value: 1 }, { value: 2 }, { value: 3 }])
    kernel.meta.set('rows[2].value', 'test', true)

    kernel.delete('rows[0]')

    expect(kernel.has('rows[2].value')).toBe(false)
    expect(kernel.meta.has('rows[2].value', 'test')).toBe(false)
  })

  it('не смешивает Meta-plane с технической metadata RaphNode', () => {
    const kernel = new RaphKernel()
    const runtime = kernel.createRuntime()
    const nodeMeta = { role: 'technical' }
    const node = new RaphNode(runtime, { meta: nodeMeta })
    kernel.set('value', 1)
    kernel.meta.set('value', 'test', { status: 'waiting' })

    expect(node.meta).toBe(nodeMeta)
    expect(node.meta).toEqual({ role: 'technical' })

    runtime.destroy()
  })
})
