import { describe, expect, it } from 'vitest'
import { RaphApp } from '@/domain/core/RaphApp'
import { RaphNode } from '@/domain/core/RaphNode'
import { RaphLocalPhaseRuntime } from '@/domain/local/RaphLocalPhase'
import { RaphLocalPropertyRuntime } from '@/domain/local/RaphLocalProperty'
import { RaphPropagation } from '@/domain/local/local.types'
import { SchedulerType, type DataAdapter, type DataObject } from '@/domain/types/base.types'

type Props = {
  value: number
}

describe('RaphRuntime local instant properties', () => {
  it('updates local properties without using DataPath adapter operations', () => {
    const calls = {
      get: 0,
      set: 0,
      merge: 0,
      delete: 0,
    }
    const adapter: DataAdapter = {
      root: () => ({}),
      get: () => {
        calls.get++
        return undefined
      },
      set: () => {
        calls.set++
      },
      merge: () => {
        calls.merge++
      },
      delete: () => {
        calls.delete++
      },
      indexOf: () => -1,
    }
    const raph = new RaphApp<Props>()
    let dirtyCount = 0

    raph.options({ scheduler: SchedulerType.Sync, adapter })
    raph.addLocalPhase(new RaphLocalPhaseRuntime<Props>(
      'update',
      'dirty',
      ({ dirty }) => {
        dirtyCount += dirty.length
      },
    ))
    raph.addLocalProperty(new RaphLocalPropertyRuntime<Props, 'value'>(
      'value',
      'update',
      RaphPropagation.None,
      undefined,
      [],
      0,
    ))
    raph.init()

    const node = new RaphNode<Props>(raph, { id: 'local' })
    raph.addNode(node)
    node.set('value', 10)

    expect(dirtyCount).toBeGreaterThan(0)
    expect(calls).toEqual({ get: 0, set: 0, merge: 0, delete: 0 })
    expect(adapter.root()).toEqual({} satisfies DataObject)
  })
})
