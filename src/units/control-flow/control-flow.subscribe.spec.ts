import { describe, expect, it } from 'vitest'

import { Raph } from '@/domain/core/Raph'
import { RaphApp } from '@/domain/core/RaphApp'
import { RaphNode } from '@/domain/core/RaphNode'
import { SchedulerType } from '@/domain/types/base.types'

describe('control flow subscriptions', () => {
  it('вызывает callback даже если пользовательские фазы не определены', () => {
    const raph = new RaphApp()
    raph.options({ scheduler: SchedulerType.Sync })

    const owner = new RaphNode(raph, { id: 'owner-1' })
    raph.addNode(owner)

    const calls: string[] = []

    raph.subscribe(owner, 'ui.menu.open', ({ events }) => {
      calls.push(events[0]?.canonical ?? '')
    })

    raph.set('ui.menu.open', true, { invalidate: false })
    raph.run()

    expect(calls).toEqual(['ui.menu.open'])
  })

  it('батчит несколько событий в одну подписку до ручного run()', () => {
    const raph = new RaphApp()
    raph.options({ scheduler: SchedulerType.Sync })

    const owner = new RaphNode(raph, { id: 'owner-2' })
    raph.addNode(owner)

    const batches: string[][] = []

    raph.subscribe(owner, 'data.*', ({ events }) => {
      batches.push(events.map(event => event.canonical))
    })

    raph.set('data.a', 1, { invalidate: false })
    raph.set('data.b', 2, { invalidate: false })

    expect(batches).toHaveLength(0)

    raph.run()

    expect(batches).toEqual([['data.a', 'data.b']])
  })

  it('прокидывает params из маски с переменными', () => {
    const raph = new RaphApp()
    raph.options({ scheduler: SchedulerType.Sync })

    const owner = new RaphNode(raph, { id: 'owner-3' })
    raph.addNode(owner)

    const captured: Array<Record<string, unknown> | undefined> = []

    raph.subscribe(owner, 'orders[id=$orderId].status', ({ params, matches }) => {
      captured.push(params)
      expect(matches).toHaveLength(1)
      expect(matches[0]?.params).toEqual({ orderId: 42 })
    })

    raph.set('orders[id=42].status', 'done', { invalidate: false })
    raph.run()

    expect(captured).toEqual([{ orderId: 42 }])
  })

  it('disposer снимает подписку и callback больше не вызывается', () => {
    const raph = new RaphApp()
    raph.options({ scheduler: SchedulerType.Sync })

    const owner = new RaphNode(raph, { id: 'owner-4' })
    raph.addNode(owner)

    let calls = 0

    const dispose = raph.subscribe(owner, 'flags.ready', () => {
      calls++
    })

    raph.set('flags.ready', true, { invalidate: false })
    raph.run()
    dispose()
    raph.set('flags.ready', false, { invalidate: false })
    raph.run()

    expect(calls).toBe(1)
  })

  it('cleanup owner-ноды удаляет pending callback из очереди', () => {
    const raph = new RaphApp()
    raph.options({ scheduler: SchedulerType.Sync })

    const owner = new RaphNode(raph, { id: 'owner-5' })
    raph.addNode(owner)

    let calls = 0

    raph.subscribe(owner, 'draft.value', () => {
      calls++
    })

    raph.set('draft.value', 1, { invalidate: false })
    owner.remove()
    raph.run()

    expect(calls).toBe(0)
  })

  it('raph.subscribe делегирует в default app и работает как синтаксический sugar', () => {
    Raph.options({ scheduler: SchedulerType.Sync })
    Raph.clearPhases()

    const owner = Raph.createNode({
      id: `control-flow-sugar-${Date.now()}`,
    })

    const calls: string[] = []

    const dispose = Raph.subscribe(
      owner,
      'ui.sheet.open',
      ({ events }) => {
        calls.push(events[0]?.canonical ?? '')
      },
    )

    Raph.set('ui.sheet.open', true, { invalidate: false })
    Raph.app.run()

    dispose()
    owner.remove()

    expect(calls).toEqual(['ui.sheet.open'])
  })
})
