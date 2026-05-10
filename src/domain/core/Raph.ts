import type {
  DataObject,
  DataPathDef,
  RaphOptions,
  RaphProperties,
  Undefinable,
} from '@/domain/types/base.types'
import type {
  ControlFlowCallback,
  ControlFlowSubscribeOptions,
} from '@/domain/types/control-flow.types'
import type { RaphEventPayloads } from '@/domain/types/events.types'
import type {
  PhaseExecutorContext,
  PhaseName,
  RaphPhase,
} from '@/domain/types/phase.types'
import type { RaphRuntimeOptions } from '@/domain/types/runtime.types'
import type { WatchCallback } from '@/domain/types/reactive.types'
import type { RaphDebug } from '@/domain/core/RaphDebug'
import type { EventBus } from '@/utils/EventBus'
import { RaphApp } from '@/domain/core/RaphApp'
import { RaphKernel } from '@/domain/core/RaphKernel'
import type { RaphRuntime } from '@/domain/core/RaphRuntime'
import {
  RAPH_DEBUG,
  RAPH_EVENTS,
  RAPH_MAX_DEPTH,
  RAPH_MAX_UPS,
  RAPH_WEIGHT_LIMIT,
} from '@/domain/core/RaphShared'
import { RaphNode } from '@/domain/core/RaphNode'
import { DataPath } from '@/domain/entities/DataPath'
import {
  extractRaphLocalAfterHandlers,
  extractRaphLocalPhases,
  extractRaphLocalProperties,
} from '@/domain/local/decorators'
import { RaphLocalPhaseRuntime } from '@/domain/local/RaphLocalPhase'
import { RaphLocalPropertyRuntime } from '@/domain/local/RaphLocalProperty'
import { RaphPropagation } from '@/domain/local/local.types'
import type {
  RaphLocalConfiguration,
  RaphLocalPhase,
  RaphLocalPhaseContext,
  RaphLocalPropertyDescriptor,
} from '@/domain/local/local.types'
import { RaphEffect } from '@/domain/reactivity/RaphEffect'
import { RaphSignal } from '@/domain/reactivity/RaphSignal'
import { RaphWatch } from '@/domain/reactivity/RaphWatch'

/**
 * Предоставляет статические операции для настройки Raph graph, phases и dirty processing.
 */
export class Raph {
  static MAX_UPS = RAPH_MAX_UPS
  static WEIGHT_LIMIT = RAPH_WEIGHT_LIMIT
  static MAX_DEPTH = RAPH_MAX_DEPTH

  //
  // Core данные
  //
  private static _app: RaphApp | null = null
  private static _contextStack: Array<RaphNode> = []
  private static _userPhases: Array<RaphPhase> = []

  //
  // Системные генераторы
  //
  private static __signalId = 0
  private static __effectId = 0
  private static __watchId = 0

  //
  // Инициализация
  //
  static {
    RAPH_DEBUG.configure({
      getApp: () => Raph.app,
      events: RAPH_EVENTS,
    })
  }

  //
  // PUBLIC API
  //

  /**
   * Применить настройки default app.
   */
  static options(opts: Partial<RaphOptions>): void {
    this.app.options(opts)
  }

  /**
   * Добавить пользовательскую фазу в default app.
   */
  static addPhase(phase: RaphPhase): void {
    this._userPhases.push(phase)
    this._syncPhases()
  }

  /**
   * Очистить все пользовательские фазы, сохранив системные.
   */
  static clearPhases(): void {
    this._userPhases = []
    this._syncPhases()
  }

  /**
   * Пересобрать фазовый pipeline default app.
   */
  static reinitPhases(): void {
    this._syncPhases()
  }

  /**
   * Полностью заменить набор пользовательских фаз.
   */
  static definePhases(phases: Array<RaphPhase>): void {
    this._userPhases = [...phases]
    this._syncPhases()
  }

  /**
   * Выполняет внутреннюю операцию configure local.
   */
  static configureLocal<
    P extends RaphProperties,
    A extends object,
    N extends RaphNode<P>,
  >(
    appCtor: () => A,
    nodeCtor: () => N,
  ): RaphLocalConfiguration<P> {
    const appInstance = appCtor()
    const nodeInstance = nodeCtor()

    const handlers = extractRaphLocalPhases<P>(appInstance)
    const nodeHooks = extractRaphLocalAfterHandlers(nodeInstance)
    const propDescriptors = extractRaphLocalProperties<P>(nodeInstance)

    const phaseMap = new Map<string, {
      process?: (payload: RaphLocalPhaseContext<P>) => void
      always: boolean
      mode: 'dirty' | 'all'
      priority: number
    }>()

    for (const handler of handlers) {
      phaseMap.set(handler.name, {
        process: handler.process,
        always: handler.always ?? false,
        mode: handler.mode ?? 'dirty',
        priority: handler.priority ?? 0,
      })
    }

    for (const prop of propDescriptors) {
      if (!phaseMap.has(prop.phase)) {
        phaseMap.set(prop.phase, {
          process: payload => Raph.processDirtyNodes({ payload }),
          always: false,
          mode: 'dirty',
          priority: 0,
        })
      }
    }

    const app = new RaphApp<P>()
    app.options({ priority: 'legacy-depth-weight-asc' })

    const phases: Record<string, RaphLocalPhase<P>> = {}
    const orderedPhases = [...phaseMap.entries()].sort(
      (a, b) => a[1].priority - b[1].priority,
    )

    for (const [name, config] of orderedPhases) {
      const phase = new RaphLocalPhaseRuntime<P>(
        name,
        config.mode,
        config.process ?? (payload => Raph.processDirtyNodes({ payload })),
        undefined,
        undefined,
        config.always,
        config.priority,
      )
      phases[name] = phase
      app.addLocalPhase(phase)
    }

    for (const { phase, methodName } of nodeHooks) {
      const targetPhase = phases[phase]
      if (!targetPhase) {
        continue
      }

      targetPhase.afterProcess = (node, localPhase) => {
        const fn = (node as any)[methodName]
        if (typeof fn === 'function') {
          fn.call(node, localPhase)
        }
      }
    }

    const props = {} as Record<keyof P, RaphLocalPropertyRuntime<P, keyof P>>

    for (const descriptor of propDescriptors) {
      const property = this._createLocalProperty(descriptor)
      props[descriptor.name] = property
      app.addLocalProperty(property)
    }

    return { app, props, phases }
  }

  /**
   * Выполняет внутреннюю операцию configure.
   */
  static configure<
    P extends RaphProperties,
    A extends object,
    N extends RaphNode<P>,
  >(
    appCtor: () => A,
    nodeCtor: () => N,
  ): RaphLocalConfiguration<P> {
    return this.configureLocal(appCtor, nodeCtor)
  }

  /**
   * Создать shared data kernel.
   */
  static createKernel(options?: ConstructorParameters<typeof RaphKernel>[0]): RaphKernel {
    return new RaphKernel(options)
  }

  /**
   * Создать runtime lane на базе shared kernel.
   */
  static createRuntime<P extends RaphProperties = RaphProperties>(
    kernel: RaphKernel,
    options: RaphRuntimeOptions = {},
  ): RaphRuntime<P> {
    return kernel.createRuntime<P>(options)
  }

  /**
   * Выполняет внутреннюю операцию process dirty nodes.
   */
  static processDirtyNodes<P extends RaphProperties>(options: {
    payload: RaphLocalPhaseContext<P>
    ignoreCompute?: boolean
  }): void {
    const { payload, ignoreCompute = false } = options

    for (const node of payload.dirty) {
      if (!ignoreCompute) {
        for (const prop of payload.phase.properties) {
          prop.computeOn(node)
        }
      }

      payload.phase.afterProcess?.(node, payload.phase)
    }
  }

  /**
   * Создать сигнал или computed-сигнал в default app.
   */
  static signal<T>(input: T | (() => T)): RaphSignal<T> {
    const id = `__signals.${this.__signalId++}`

    const path = DataPath.fromString(id)

    const compute = typeof input === 'function' ? (input as () => T) : undefined

    // RaphSignal сам делает app.addNode(this) и (для computed) первый update()
    const sig = new RaphSignal<T>(this.app, id, path, compute)

    if (!compute) {
      // задать стартовое значение без notify/dirty
      this.app.dataAdapter.set(path, input as unknown)
    }

    return sig
  }

  /**
   * Создать реактивный effect в default app.
   */
  static effect(
    fn: () => void | (() => void),
    opts?: { weight?: number, immediate?: boolean },
  ): () => void {
    const id = `__effects.${this.__effectId++}`
    const eff = new RaphEffect(this.app, fn, {
      id,
      weight: opts?.weight,
      immediate: opts?.immediate ?? true,
    })

    // Если immediate=false - добавим в очередь выбранной фазы,
    // чтобы эффект выполнился там и захватил зависимости.
    if (opts?.immediate === false) {
      this.app.dirty('__effects' as PhaseName, eff)
    }

    // Вернём disposer
    return () => eff.stop()
  }

  /**
   * Подписка на один или несколько путей/масок.
   * Колбэк получает батч событий текущего тика.
   * Возвращает disposer.
   */
  static watch(
    maskOrMasks: DataPathDef | Array<DataPathDef>,
    cb: WatchCallback,
    opts?: { weight?: number },
  ): () => void {
    const masks = Array.isArray(maskOrMasks) ? maskOrMasks : [maskOrMasks]
    const id = `__watch.${this.__watchId++}`
    const node = new RaphWatch(this.app, id, masks, cb, opts?.weight ?? 0)

    return () => node.remove()
  }

  /**
   * Получить значение из default app.
   */
  static get(
    path: DataPathDef,
    opts?: {
      vars?: object
    },
  ): Undefinable<unknown> {
    return this.app.get(path, opts)
  }

  /**
   * Установить значение в default app.
   */
  static set(
    path: DataPathDef,
    value: unknown,
    opts?: { invalidate?: boolean, vars?: Record<string, any> },
  ): void {
    this.app.set(path, value, opts)
  }

  /**
   * Слить значение в default app.
   */
  static merge(
    path: DataPathDef,
    value: unknown,
    opts?: { invalidate?: boolean, vars?: Record<string, any> },
  ): void {
    this.app.merge(path, value, opts)
  }

  /**
   * Удалить значение из default app.
   */
  static delete(
    path: DataPathDef,
    opts?: { invalidate?: boolean, vars?: Record<string, any> },
  ): void {
    this.app.delete(path, opts)
  }

  //
  // PRIVATE (STACK)
  //

  /**
   * Вернуть текущую ноду вычислительного контекста.
   */
  static get currentNode(): RaphNode | undefined {
    return this._contextStack[this._contextStack.length - 1]
  }

  /**
   * Положить ноду в стек вычислительного контекста.
   */
  static pushContext(node: RaphNode): void {
    this._contextStack.push(node)
  }

  /**
   * Убрать верхнюю ноду из стека вычислительного контекста.
   */
  static popContext(): void {
    this._contextStack.pop()
  }

  //
  // SUGAR
  //
  /**
   * Создать обычную runtime-ноду в default app.
   */
  static createNode(opts?: {
    id?: string
    weight?: number
    meta?: Record<string, unknown>
    type?: string
  }): RaphNode {
    const node = new RaphNode(Raph.app, opts)

    Raph.app.addNode(node)

    return node
  }

  /**
   * Подписать ноду на маску данных.
   */
  static track(
    node: RaphNode,
    mask: DataPathDef,
    opts?: {
      vars?: Record<string, any>
      wildcardDynamic?: boolean
    },
  ): void {
    Raph.app.track(node, mask, opts)
  }

  /**
   * Подписать owner-ноду на control-flow событие по маске.
   */
  static subscribe(
    node: RaphNode,
    maskOrMasks: DataPathDef | Array<DataPathDef>,
    callback: ControlFlowCallback,
    opts?: ControlFlowSubscribeOptions,
  ): () => void
  /**
   * Выполняет внутреннюю операцию subscribe.
   */
  static subscribe(node: RaphNode, opts: {
    mask: DataPathDef | Array<DataPathDef>
    callback: ControlFlowCallback
    vars?: Record<string, any>
    wildcardDynamic?: boolean
    weight?: number
  }): () => void
  /**
   * Выполняет внутреннюю операцию subscribe.
   */
  static subscribe(
    node: RaphNode,
    maskOrMasksOrOpts:
      | DataPathDef
      | Array<DataPathDef>
      | {
        mask: DataPathDef | Array<DataPathDef>
        callback: ControlFlowCallback
        vars?: Record<string, any>
        wildcardDynamic?: boolean
        weight?: number
      },
    callback?: ControlFlowCallback,
    opts?: ControlFlowSubscribeOptions,
  ): () => void {
    if (
      typeof maskOrMasksOrOpts === 'object'
      && !Array.isArray(maskOrMasksOrOpts)
      && 'mask' in maskOrMasksOrOpts
    ) {
      return Raph.app.subscribe(
        node,
        maskOrMasksOrOpts.mask,
        maskOrMasksOrOpts.callback,
        {
          vars: maskOrMasksOrOpts.vars,
          wildcardDynamic: maskOrMasksOrOpts.wildcardDynamic,
          weight: maskOrMasksOrOpts.weight,
        },
      )
    }

    return Raph.app.subscribe(
      node,
      maskOrMasksOrOpts,
      callback as ControlFlowCallback,
      opts,
    )
  }

  /**
   * Снять все control-flow подписки owner-ноды из default app.
   */
  static unsubscribeOwner(node: RaphNode): void {
    Raph.app.unsubscribeOwner(node)
  }

  //
  // ACCESS
  //

  /**
   * Вернуть default app.
   */
  static get app(): RaphApp {
    if (!Raph._app) {
      Raph._app = new RaphApp()
      Raph._syncPhases()
    }

    return Raph._app
  }

  /**
   * Вернуть debug-объект Raph.
   */
  static get debug(): RaphDebug {
    return RAPH_DEBUG
  }

  /**
   * Вернуть глобальную event-шину Raph.
   */
  static get events(): EventBus<RaphEventPayloads> {
    return RAPH_EVENTS
  }

  /**
   * Вернуть корневые данные default app.
   */
  static get data(): DataObject {
    return Raph.app.data
  }

  /**
   * Выполняет внутреннюю операцию make descriptor computed local.
   */
  static MakeDescriptorComputedLocal<Props extends RaphProperties, K extends keyof Props>(
    name: K,
    phase: string,
    defaultValue: Props[K],
  ): RaphLocalPropertyDescriptor<Props, K> {
    return {
      name,
      phase,
      propagation: RaphPropagation.None,
      defaultValue,
      compute: node => node.get(name) ?? defaultValue,
    }
  }

  /**
   * Выполняет внутреннюю операцию make descriptor computed inherited boolean.
   */
  static MakeDescriptorComputedInheritedBoolean<Props extends RaphProperties, K extends keyof Props>(
    name: K,
    phase: string,
    defaultValue = true as Props[K],
  ): RaphLocalPropertyDescriptor<Props, K> {
    return {
      name,
      phase,
      propagation: RaphPropagation.Down,
      defaultValue,
      compute: node =>
        ((node.get(name) ?? defaultValue) && (node.parent?.get(name) ?? true)) as Props[K],
    }
  }

  /**
   * Выполняет внутреннюю операцию create local property.
   */
  private static _createLocalProperty<P extends RaphProperties, K extends keyof P>(
    descriptor: RaphLocalPropertyDescriptor<P, K>,
  ): RaphLocalPropertyRuntime<P, K> {
    return new RaphLocalPropertyRuntime(
      descriptor.name,
      descriptor.phase,
      descriptor.propagation ?? RaphPropagation.None,
      descriptor.compute,
      descriptor.dependsOn ?? [],
      descriptor.defaultValue,
    )
  }

  /**
   * Синхронизирует системные и пользовательские фазы с default app.
   */
  private static _syncPhases(): void {
    if (!Raph._app) {
      return
    }

    Raph._app.definePhases([
      ...Raph._makeSystemPhases(),
      ...Raph._userPhases,
    ])
  }

  /**
   * Возвращает встроенные системные фазы Raph.
   * Эти фазы всегда присутствуют в default app и не должны описываться в приложении вручную.
   */
  private static _makeSystemPhases(): Array<RaphPhase> {
    return [
      {
        name: '__computed' as PhaseName,
        traversal: 'dirty-and-down',
        routes: ['__signals.*'],
        nodes: (node: RaphNode) => node instanceof RaphSignal,
        each: (ctx: PhaseExecutorContext) => {
          (ctx.node as RaphSignal<any>).update()
        },
      },
      {
        name: '__effects' as PhaseName,
        traversal: 'dirty-only',
        routes: ['__signals.*'],
        nodes: (node: RaphNode) => node instanceof RaphEffect,
        each: (ctx: PhaseExecutorContext) => {
          (ctx.node as RaphEffect).run()
        },
      },
      {
        name: '__watch' as PhaseName,
        traversal: 'dirty-only',
        routes: ['*'],
        nodes: (node: RaphNode) => node instanceof RaphWatch,
        each: (ctx: PhaseExecutorContext) => {
          (ctx.node as RaphWatch).run(ctx)
        },
      },
    ]
  }
}
