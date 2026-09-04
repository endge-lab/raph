import type { RaphEventPayloads } from '@/domain/types/events.types'
import { afterEach, describe, expect, it } from 'vitest'
import { RaphApp } from '@/domain/core/RaphApp'
import { RaphDebug } from '@/domain/core/RaphDebug'
import { RaphNode } from '@/domain/core/RaphNode'
import { EventBus } from '@/utils/EventBus'

function createDebugHarness() {
  const app = new RaphApp()
  const events = new EventBus<RaphEventPayloads>()
  const debug = new RaphDebug()
  debug.configure({ getApp: () => app, events })
  return { app, debug, events }
}

describe('отладочные leases Raph', () => {
  const cleanups: Array<() => void> = []

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) {
      cleanup()
    }
  })

  it('сохраняет debug активным до освобождения последнего вложенного lease', () => {
    const { app, debug, events } = createDebugHarness()
    const first = debug.acquire()
    const second = debug.acquire()
    cleanups.push(() => first.release(), () => second.release())

    const node = new RaphNode(app, { id: 'leased' })
    app.addNode(node)
    events.emit('node:tracked', { node, path: 'rows.first' })
    expect(debug.getFlat()).toEqual([
      expect.objectContaining({ id: 'leased', routes: ['rows.first'] }),
    ])

    first.release()
    expect(debug.getFlat()).toHaveLength(1)
    second.release()
    expect(debug.getFlat()).toEqual([])
  })

  it('делает release идемпотентным и сохраняет совместимый ручной debug', () => {
    const { app, debug, events } = createDebugHarness()
    debug.enable(true)
    cleanups.push(() => debug.enable(false))
    const lease = debug.acquire()

    lease.release()
    lease.release()
    const node = new RaphNode(app, { id: 'manual' })
    app.addNode(node)
    events.emit('node:tracked', { node, path: 'manual.path' })
    expect(debug.getFlat()).toHaveLength(1)

    debug.enable(false)
    expect(debug.getFlat()).toEqual([])
  })

  it('сохраняет routes равными активным частичным и полным подпискам', () => {
    const { app, debug, events } = createDebugHarness()
    const lease = debug.acquire()
    cleanups.push(() => lease.release())
    const node = new RaphNode(app, { id: 'routes' })
    app.addNode(node)

    events.emit('node:tracked', { node, path: 'rows.a' })
    events.emit('node:tracked', { node, path: 'rows.b' })
    events.emit('node:untracked', { node, path: 'rows.a' })
    expect(debug.getFlat()[0].routes).toEqual(['rows.b'])

    events.emit('node:untracked', { node })
    expect(debug.getFlat()[0].routes).toEqual([])
  })

  it('восстанавливает routes, существовавшие до первого lease', () => {
    const { app, debug } = createDebugHarness()
    const node = new RaphNode(app, { id: 'pre-existing' })
    app.addNode(node)
    ;(app as unknown as { track: (node: RaphNode, path: string) => void })
      .track(node, 'rows.preExisting')

    const lease = debug.acquire()
    cleanups.push(() => lease.release())

    expect(debug.getFlat()).toEqual([
      expect.objectContaining({ id: 'pre-existing', routes: ['rows.preExisting'] }),
    ])
  })

  it('удаляет узел, даже если ранее у него были routes', () => {
    const { app, debug, events } = createDebugHarness()
    const lease = debug.acquire()
    cleanups.push(() => lease.release())
    const node = new RaphNode(app, { id: 'removed' })
    app.addNode(node)
    events.emit('node:tracked', { node, path: 'rows.removed' })

    node.remove()
    events.emit('nodes:changed', { graph: app.graph })

    expect(debug.getFlat()).toEqual([])
  })
})
