import type { RaphLocalPhaseContext, RaphProperties } from '@/main'
import { describe, expect, it, vi } from 'vitest'
import {
  Raph,
  RaphAfter,
  RaphApp,
  RaphLocalPhase,

  RaphNode,
  RaphPropagation,

  RaphProperty,
  RaphSchedulerType,
} from '@/main'

interface LocalProps extends RaphProperties {
  active: boolean
  width: number
  doubleWidth: number
  renderToken: number
}

/**
 * Описывает Nova-node LocalNode и его runtime-поведение.
 */
class LocalNode extends RaphNode<LocalProps> {
  readonly afterCalls: Array<string> = []

  /**
   * Создает экземпляр LocalNode и подготавливает базовое состояние.
   */
  constructor(app = new RaphApp<LocalProps>(), id = 'node') {
    super(app, { id })
  }

  /**
   * Возвращает active для LocalNode.
   */
  @RaphProperty({
    phase: 'update',
    default: true,
    propagation: RaphPropagation.Down,
  })
  get active(): boolean {
    return this.get('active')
  }

  /**
   * Обновляет active для LocalNode.
   */
  set active(value: boolean) {
    this.set('active', value)
  }

  /**
   * Возвращает width для LocalNode.
   */
  @RaphProperty({ phase: 'layout', default: 0 })
  get width(): number {
    return this.get('width')
  }

  /**
   * Обновляет width для LocalNode.
   */
  set width(value: number) {
    this.set('width', value)
  }

  /**
   * Возвращает double Width для LocalNode.
   */
  @RaphProperty({
    phase: 'layout',
    default: 0,
    dependsOn: ['width'],
    compute: node => node.width * 2,
  })
  get doubleWidth(): number {
    return this.get('doubleWidth')
  }

  /**
   * Возвращает render Token для LocalNode.
   */
  @RaphProperty({ phase: 'render', default: 0 })
  get renderToken(): number {
    return this.get('renderToken')
  }

  /**
   * Обновляет render Token для LocalNode.
   */
  set renderToken(value: number) {
    this.set('renderToken', value)
  }

  /**
   * Выполняет действие afterLayout в рамках ответственности LocalNode.
   */
  @RaphAfter({ phase: 'layout' })
  afterLayout(): void {
    this.afterCalls.push(`${this.id}:${this.doubleWidth}`)
  }
}

/**
 * Описывает ответственность LocalRuntime в архитектуре проекта.
 */
class LocalRuntime {
  readonly phases: Array<string> = []
  readonly phaseEvents: Array<{ nodeId: string, paths: Array<string> }> = []

  /**
   * Выполняет действие before в рамках ответственности LocalRuntime.
   */
  @RaphLocalPhase({ name: 'before', priority: -1, always: true })
  before(): void {
    this.phases.push('before')
  }

  /**
   * Обновляет runtime-состояние LocalRuntime.
   */
  @RaphLocalPhase({ name: 'update', priority: 0 })
  update(payload: RaphLocalPhaseContext<LocalProps>): void {
    this.phases.push(`update:${payload.dirty.map(node => node.id).join(',')}`)
    for (const [node, events] of payload.events ?? []) {
      this.phaseEvents.push({
        nodeId: node.id,
        paths: events.map(event => event.canonical),
      })
    }
    Raph.processDirtyNodes({ payload })
  }

  /**
   * Выполняет действие layout в рамках ответственности LocalRuntime.
   */
  @RaphLocalPhase({ name: 'layout', priority: 1 })
  layout(payload: RaphLocalPhaseContext<LocalProps>): void {
    this.phases.push(`layout:${payload.dirty.map(node => node.id).join(',')}`)
    Raph.processDirtyNodes({ payload })
  }

  /**
   * Выполняет отрисовку LocalRuntime.
   */
  @RaphLocalPhase({ name: 'render', priority: 2, mode: 'all' })
  render(payload: RaphLocalPhaseContext<LocalProps>): void {
    this.phases.push(`render:${payload.dirty.map(node => node.id).join(',')}`)
    Raph.processDirtyNodes({ payload, ignoreCompute: true })
  }
}

function createRuntime() {
  const runtime = new LocalRuntime()
  const configured = Raph.configureLocal<LocalProps, LocalRuntime, LocalNode>(
    () => runtime,
    () => new LocalNode(),
  )
  configured.app.options({ scheduler: RaphSchedulerType.Sync })
  configured.app.init()
  runtime.phases.length = 0
  return { runtime, ...configured }
}

describe('raph local/instant runtime', () => {
  it('sets a local property and runs only the related phase once per node', async () => {
    const { app, runtime } = createRuntime()
    const node = new LocalNode(app, 'n1')
    app.options({ scheduler: RaphSchedulerType.Microtask })
    app.addNode(node)
    await Promise.resolve()
    runtime.phases.length = 0
    node.afterCalls.length = 0

    node.width = 10
    node.width = 11

    await Promise.resolve()
    expect(runtime.phases).toEqual([
      'before',
      'layout:n1',
    ])
    expect(node.width).toBe(11)
    expect(node.doubleWidth).toBe(22)
    expect(node.afterCalls).toEqual(['n1:22'])
  })

  it('keeps dependsOn compute order inside a local phase', () => {
    const { app } = createRuntime()
    const node = new LocalNode(app, 'n1')
    app.addNode(node)

    node.width = 7

    expect(node.doubleWidth).toBe(14)
  })

  it('передаёт data events соответствующей ноде local phase', () => {
    const { app, runtime } = createRuntime()
    const node = new LocalNode(app, 'observer')
    app.addNode(node)
    runtime.phaseEvents.length = 0
    app.observeData(node, 'data.*', { phase: 'update' })

    app.set('data.value', 1)

    expect(runtime.phaseEvents).toEqual([{
      nodeId: 'observer',
      paths: ['data.value'],
    }])
  })

  it('propagates down through the ordered tree without touching unrelated nodes', () => {
    const { app, runtime } = createRuntime()
    const parent = new LocalNode(app, 'parent')
    const child = new LocalNode(app, 'child')
    const sibling = new LocalNode(app, 'sibling')

    app.addNode(parent)
    parent.addChild(child)
    app.addNode(sibling)
    runtime.phases.length = 0

    parent.active = false

    expect(parent.active).toBe(false)
    expect(child.active).toBe(false)
    expect(sibling.active).toBe(true)
    expect(runtime.phases).toContain('update:parent,child')
  })

  it('runs always phases and mode=all phases with the app root/tree', () => {
    const { app, runtime } = createRuntime()
    const first = new LocalNode(app, 'first')
    const second = new LocalNode(app, 'second')

    app.addNode(first)
    app.addNode(second)
    runtime.phases.length = 0

    first.renderToken = 1

    expect(runtime.phases[0]).toBe('before')
    expect(runtime.phases).toContain('render:__root__,first,second')
  })

  it('schedules local dirty work through the selected scheduler', async () => {
    const { app } = createRuntime()
    const spy = vi.fn()
    const node = new LocalNode(app, 'n1')

    app.options({ scheduler: RaphSchedulerType.Microtask })
    app.addNode(node)
    await Promise.resolve()
    node.afterCalls.push = spy

    node.width = 3

    expect(spy).not.toHaveBeenCalled()
    await Promise.resolve()
    expect(spy).toHaveBeenCalledWith('n1:6')
  })

  it('reset clears tree nodes and local dirty queues', () => {
    const { app } = createRuntime()
    const node = new LocalNode(app, 'n1')
    app.addNode(node)
    node.width = 4

    app.reset()

    expect(app.getNode('n1')).toBeUndefined()
    expect(app.root.children).toEqual([])
  })
})
