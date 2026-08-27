import type { RaphLocalPhaseContext, RaphProperties } from '@/main'
import { bench, describe } from 'vitest'
import {
  Raph,
  RaphApp,
  RaphLocalPhase,

  RaphNode,
  RaphPropagation,

  RaphProperty,
  RaphSchedulerType,
} from '@/main'

interface BenchProps extends RaphProperties {
  active: boolean
  value: number
  renderToken: number
}

/**
 * Описывает Nova-node BenchNode и его runtime-поведение.
 */
class BenchNode extends RaphNode<BenchProps> {
  /**
   * Создает экземпляр BenchNode и подготавливает базовое состояние.
   */
  constructor(app = new RaphApp<BenchProps>(), id = 'node') {
    super(app, { id })
  }

  /**
   * Возвращает active для BenchNode.
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
   * Обновляет active для BenchNode.
   */
  set active(value: boolean) {
    this.set('active', value)
  }

  /**
   * Возвращает value для BenchNode.
   */
  @RaphProperty({ phase: 'update', default: 0 })
  get value(): number {
    return this.get('value')
  }

  /**
   * Обновляет value для BenchNode.
   */
  set value(value: number) {
    this.set('value', value)
  }

  /**
   * Возвращает render Token для BenchNode.
   */
  @RaphProperty({ phase: 'render', default: 0 })
  get renderToken(): number {
    return this.get('renderToken')
  }

  /**
   * Обновляет render Token для BenchNode.
   */
  set renderToken(value: number) {
    this.set('renderToken', value)
  }
}

/**
 * Описывает ответственность BenchRuntime в архитектуре проекта.
 */
class BenchRuntime {
  /**
   * Обновляет runtime-состояние BenchRuntime.
   */
  @RaphLocalPhase({ name: 'update', priority: 0 })
  update(payload: RaphLocalPhaseContext<BenchProps>): void {
    Raph.processDirtyNodes({ payload })
  }

  /**
   * Выполняет отрисовку BenchRuntime.
   */
  @RaphLocalPhase({ name: 'render', priority: 1, mode: 'all' })
  render(payload: RaphLocalPhaseContext<BenchProps>): void {
    Raph.processDirtyNodes({ payload, ignoreCompute: true })
  }
}

function createBenchTree(size: number) {
  const runtime = new BenchRuntime()
  const { app } = Raph.configureLocal<BenchProps, BenchRuntime, BenchNode>(
    () => runtime,
    () => new BenchNode(),
  )

  // Tree construction itself is not part of the benchmark. Local registration
  // marks defaults dirty, so scheduler is paused until the fixture is complete.
  ;(app as any)._scheduler = () => {}
  ;(app as any)._schedulerPending = false

  app.init()

  const root = new BenchNode(app, 'root')
  app.addNode(root)

  const nodes: Array<BenchNode> = [root]
  for (let i = 1; i < size; i++) {
    const node = new BenchNode(app, `n${i}`)
    nodes[(i - 1) >> 1].addChild(node)
    nodes.push(node)
  }

  ;(app as any)._scheduler = (cb: VoidFunction) => cb()
  ;(app as any)._schedulerPending = false
  app.run()
  app.options({ scheduler: RaphSchedulerType.Sync })

  return { app, nodes, root }
}

const local10k = createBenchTree(10_000)

let downState = false

const down10k = createBenchTree(10_000)

const manual1k = createBenchTree(1_000)

const burst1k = createBenchTree(1_000)

const empty1k = createBenchTree(1_000)

describe('raph local/instant benchmarks', () => {
  const benchOptions = {
    iterations: 5,
    warmupIterations: 1,
    time: 10,
    warmupTime: 5,
  }

  bench('local prop update x10k', () => {
    const { nodes } = local10k
    for (let i = 0; i < nodes.length; i++) {
      nodes[i].value = i
    }
  }, benchOptions)

  bench('root down propagation x10k', () => {
    downState = !downState
    down10k.root.active = downState
  }, benchOptions)

  bench('manual render dirty x100k', () => {
    for (let i = 0; i < 100_000; i++) {
      manual1k.app.dirty('render', manual1k.nodes[i % manual1k.nodes.length], { invalidate: false })
    }
    manual1k.app.run()
  }, benchOptions)

  bench('burst 1000 updates', () => {
    for (let i = 0; i < 1_000; i++) {
      burst1k.nodes[i].value = i
    }
  }, benchOptions)

  bench('no-dirty tick', () => {
    empty1k.app.run()
  }, benchOptions)
})
