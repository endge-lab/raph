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
  type RaphLocalPhaseContext,
  type RaphProperties,
} from '@/main'

interface LocalProps extends RaphProperties {
  active: boolean
  width: number
  doubleWidth: number
  renderToken: number
}

class LocalNode extends RaphNode<LocalProps> {
  readonly afterCalls: Array<string> = []

  constructor(app = new RaphApp<LocalProps>(), id = 'node') {
    super(app, { id })
  }

  @RaphProperty({
    phase: 'update',
    default: true,
    propagation: RaphPropagation.Down,
  })
  get active(): boolean {
    return this.get('active')
  }
  set active(value: boolean) {
    this.set('active', value)
  }

  @RaphProperty({ phase: 'layout', default: 0 })
  get width(): number {
    return this.get('width')
  }
  set width(value: number) {
    this.set('width', value)
  }

  @RaphProperty({
    phase: 'layout',
    default: 0,
    dependsOn: ['width'],
    compute: node => node.width * 2,
  })
  get doubleWidth(): number {
    return this.get('doubleWidth')
  }

  @RaphProperty({ phase: 'render', default: 0 })
  get renderToken(): number {
    return this.get('renderToken')
  }
  set renderToken(value: number) {
    this.set('renderToken', value)
  }

  @RaphAfter({ phase: 'layout' })
  afterLayout(): void {
    this.afterCalls.push(`${this.id}:${this.doubleWidth}`)
  }
}

class LocalRuntime {
  readonly phases: Array<string> = []

  @RaphLocalPhase({ name: 'before', priority: -1, always: true })
  before(): void {
    this.phases.push('before')
  }

  @RaphLocalPhase({ name: 'update', priority: 0 })
  update(payload: RaphLocalPhaseContext<LocalProps>): void {
    this.phases.push(`update:${payload.dirty.map(node => node.id).join(',')}`)
    Raph.processDirtyNodes({ payload })
  }

  @RaphLocalPhase({ name: 'layout', priority: 1 })
  layout(payload: RaphLocalPhaseContext<LocalProps>): void {
    this.phases.push(`layout:${payload.dirty.map(node => node.id).join(',')}`)
    Raph.processDirtyNodes({ payload })
  }

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

describe('Raph local/instant runtime', () => {
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
