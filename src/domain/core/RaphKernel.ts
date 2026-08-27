import type { RaphDerivedHandle } from '@/domain/derived/RaphDerivedHandle'
import type {
  DataAdapter,
  DataObject,
  DataPathDef,
  RaphProperties,
} from '@/domain/types/base.types'
import type {
  RaphDerivedManagerSnapshot,
  RaphDerivedMutationKind,
  RaphDerivedMutationRecord,
  RaphDerivedOptions,
} from '@/domain/types/derived.types'
import type {
  RaphDataObserver,
  RaphKernelPendingEvent,
  RaphObserveDataOptions,
  RaphRuntimeOptions,
} from '@/domain/types/runtime.types'
import { RaphRouter } from '@/domain/core/RaphRouter'
import { RaphRuntime } from '@/domain/core/RaphRuntime'
import { RaphDerivedManager } from '@/domain/derived/RaphDerivedManager'
import { DefaultDataAdapter } from '@/domain/entities/data-adapter'
import { DataPath } from '@/domain/entities/DataPath'

/**
 * Управляет shared data-store и маршрутизацией business data events между runtime lanes.
 */
export class RaphKernel {
  readonly id: string

  private _dataAdapter: DataAdapter
  private readonly _runtimes = new Set<RaphRuntime<any>>()
  private readonly _dataObservers = new Set<RaphDataObserver<any>>()
  private readonly _dataObserverRouter = new RaphRouter<RaphDataObserver<any>>()
  private _dataObserverCounter = 0
  private _transactionDepth = 0
  private readonly _pendingEvents: Array<RaphDerivedMutationRecord> = []
  private _derivedManager: RaphDerivedManager | null = null

  /**
   * Создает instance и подготавливает shared data-store.
   */
  constructor(options: { id?: string, adapter?: DataAdapter } = {}) {
    this.id = options.id ?? 'kernel'
    this._dataAdapter = options.adapter ?? new DefaultDataAdapter()
  }

  /**
   * Создает runtime lane поверх этого kernel.
   */
  createRuntime<Props extends RaphProperties = RaphProperties>(
    options: RaphRuntimeOptions = {},
  ): RaphRuntime<Props> {
    return new RaphRuntime<Props>({
      ...options,
      kernel: this,
    })
  }

  /**
   * Регистрирует runtime lane.
   */
  registerRuntime(runtime: RaphRuntime<any>): void {
    this._runtimes.add(runtime)
  }

  /**
   * Снимает runtime lane и все его data observers.
   */
  unregisterRuntime(runtime: RaphRuntime<any>): void {
    this._derivedManager?.disposeRuntime(runtime)
    this.removeDataObserversByRuntime(runtime)
    this._runtimes.delete(runtime)
  }

  /** Регистрирует derived-ноду текущего runtime во внутреннем kernel manager. */
  registerDerived<TSource, TTarget>(
    runtime: RaphRuntime<any>,
    options: RaphDerivedOptions<TSource, TTarget>,
  ): RaphDerivedHandle {
    return this._getDerivedManager().register(runtime, options)
  }

  /** Возвращает deterministic snapshot derived registry для debug и cleanup-проверок. */
  getDerivedSnapshot(): RaphDerivedManagerSnapshot {
    return this._derivedManager?.snapshot() ?? {
      registrations: 0,
      graphNodes: 0,
      graphEdges: 0,
      sourceRoutes: 0,
      targetRoutes: 0,
      dirtyHandles: 0,
      pendingKeys: 0,
      errors: 0,
      stabilizing: false,
    }
  }

  /** Удаляет все derived registrations kernel, сохраняя target по policy каждого handle. */
  disposeAllDerived(): void {
    this._derivedManager?.disposeAll()
  }

  /** Удаляет derived registrations конкретного runtime; используется runtime reset/destroy. */
  disposeRuntimeDerived(runtime: RaphRuntime<any>): void {
    this._derivedManager?.disposeRuntime(runtime)
  }

  /**
   * Регистрирует data observer.
   */
  registerDataObserver<Props extends RaphProperties>(
    runtime: RaphRuntime<Props>,
    node: RaphDataObserver<Props>['node'],
    mask: DataPathDef,
    options: RaphObserveDataOptions,
  ): () => void {
    const observer: RaphDataObserver<Props> = {
      id: `__dataObserver.${this._dataObserverCounter++}`,
      runtime,
      node,
      mask,
      phase: options.phase,
      traversal: options.traversal,
      vars: options.vars,
      wildcardDynamic: options.wildcardDynamic,
    }
    const route = DataPath.from(mask, {
      vars: options.vars,
      wildcardDynamic: options.wildcardDynamic,
    })

    this._dataObserverRouter.add(route, observer)
    this._dataObservers.add(observer)

    return () => {
      this._dataObserverRouter.remove(route, observer)
      this._dataObservers.delete(observer)
    }
  }

  /**
   * Снимает data observers runtime.
   */
  removeDataObserversByRuntime(runtime: RaphRuntime<any>): void {
    for (const observer of this._collectDataObservers()) {
      if (observer.runtime === runtime) {
        this._dataObserverRouter.removePayload(observer)
        this._dataObservers.delete(observer)
      }
    }
  }

  /**
   * Снимает data observers конкретной ноды.
   */
  removeDataObserversByNode(runtime: RaphRuntime<any>, node: RaphDataObserver['node']): void {
    for (const observer of this._collectDataObservers()) {
      if (observer.runtime === runtime && observer.node === node) {
        this._dataObserverRouter.removePayload(observer)
        this._dataObservers.delete(observer)
      }
    }
  }

  /**
   * Выполняет transaction с отложенной доставкой dirty events.
   */
  transaction(fn: () => void): void {
    let callbackError: unknown
    let flushError: unknown
    this._transactionDepth++
    try {
      fn()
    }
    catch (error) {
      callbackError = error
    }
    finally {
      this._transactionDepth--
      if (this._transactionDepth === 0) {
        try {
          this._flushPendingEvents()
        }
        catch (error) {
          flushError = error
        }
      }
    }
    if (callbackError && flushError) {
      throw new AggregateError([callbackError, flushError], '[RaphKernel] Transaction and derived stabilization failed.')
    }
    if (callbackError) {
      throw callbackError
    }
    if (flushError) {
      throw flushError
    }
  }

  /**
   * Получает значение по пути.
   */
  get(
    path: DataPathDef,
    opts?: { vars?: Record<string, any> },
  ): unknown {
    return this._dataAdapter.get(path, opts)
  }

  /**
   * Записывает значение по пути.
   */
  set(
    path: DataPathDef,
    value: unknown,
    opts?: { invalidate?: boolean, vars?: Record<string, any> },
  ): void {
    if (this._derivedManager?.size) {
      this._derivedManager.assertExternalMutationAllowed(path)
    }
    this._dataAdapter.set(path, value, opts)
    this._recordMutation('set', path, opts)
  }

  /**
   * Сливает значение по пути.
   */
  merge(
    path: DataPathDef,
    value: unknown,
    opts?: { invalidate?: boolean, vars?: Record<string, any> },
  ): void {
    if (this._derivedManager?.size) {
      this._derivedManager.assertExternalMutationAllowed(path)
    }
    this._dataAdapter.merge(path, value, opts)
    this._recordMutation('merge', path, opts)
  }

  /**
   * Удаляет значение по пути.
   */
  delete(
    path: DataPathDef,
    opts?: { invalidate?: boolean, vars?: Record<string, any> },
  ): void {
    if (this._derivedManager?.size) {
      this._derivedManager.assertExternalMutationAllowed(path)
    }
    this._dataAdapter.delete(path, opts)
    this._recordMutation('delete', path, opts)
  }

  /**
   * Доставляет событие изменения данных runtime lanes.
   */
  notify(
    path: DataPathDef,
    opts?: { invalidate?: boolean, vars?: Record<string, any> },
  ): void {
    if (this._derivedManager?.size) {
      this._derivedManager.assertExternalMutationAllowed(path)
    }
    this._recordMutation('notify', path, opts)
  }

  /**
   * Заменяет data adapter.
   */
  setDataAdapter(adapter: DataAdapter): void {
    this._dataAdapter = adapter
  }

  /**
   * Очищает shared data и observers.
   */
  clear(): void {
    const root = this._dataAdapter.root()
    for (const key of Object.keys(root)) {
      delete root[key]
    }
    this._pendingEvents.length = 0
    this._transactionDepth = 0
  }

  /**
   * Выполняет внутреннюю операцию flush pending events.
   */
  private _flushPendingEvents(): void {
    if (this._pendingEvents.length === 0) {
      return
    }

    const mutations = this._pendingEvents.splice(0)
    this._stabilizeAndDeliver(mutations)
  }

  /**
   * Выполняет внутреннюю операцию deliver events.
   */
  private _deliverEvents(events: Array<RaphKernelPendingEvent>): void {
    const runtimesToInvalidate = new Set<RaphRuntime<any>>()

    for (const pending of events) {
      const invalidate = pending.opts?.invalidate ?? true
      const canonical = DataPath.from(pending.path, {
        vars: pending.opts?.vars,
        wildcardDynamic: true,
      })
      const observers = this._dataObserverRouter.match(canonical)

      for (const observer of observers) {
        if (observer.runtime.enqueueDataObserver(observer, pending.path, pending.opts)) {
          if (invalidate) {
            runtimesToInvalidate.add(observer.runtime)
          }
        }
      }

      for (const runtime of this._runtimes) {
        const affected = runtime.notify(pending.path, {
          ...pending.opts,
          invalidate: false,
        })
        if (affected && invalidate) {
          runtimesToInvalidate.add(runtime)
        }
      }
    }

    for (const runtime of runtimesToInvalidate) {
      runtime.invalidate()
    }
  }

  /** Буферизует mutation либо немедленно стабилизирует derived graph. */
  private _recordMutation(
    kind: RaphDerivedMutationKind,
    path: DataPathDef,
    opts?: { invalidate?: boolean, vars?: Record<string, any> },
  ): void {
    const mutation: RaphDerivedMutationRecord = {
      kind,
      path: DataPath.from(path, { vars: opts?.vars }),
      originalPath: path,
      opts,
    }
    if (this._transactionDepth > 0) {
      this._pendingEvents.push(mutation)
      return
    }
    this._stabilizeAndDeliver([mutation])
  }

  /** Выполняет derived fast-path и публикует events только после стабилизации. */
  private _stabilizeAndDeliver(mutations: RaphDerivedMutationRecord[]): void {
    if (!mutations.length) {
      return
    }
    if (!this._derivedManager?.size) {
      this._deliverEvents(mutations.map(mutation => ({
        path: mutation.originalPath,
        opts: mutation.opts,
      })))
      return
    }
    const result = this._derivedManager.stabilize(mutations)
    this._publishDerived(result.records, result.errors)
  }

  /** Доставляет стабилизированный batch, затем сообщает compute errors. */
  private _publishDerived(records: RaphDerivedMutationRecord[], errors: Error[]): void {
    if (records.length) {
      this._deliverEvents(records.map(record => ({
        path: record.originalPath,
        opts: record.opts,
      })))
    }
    if (errors.length === 1) {
      throw errors[0]
    }
    if (errors.length > 1) {
      throw new AggregateError(errors, '[RaphDerived] Multiple computations failed.')
    }
  }

  private _getDerivedManager(): RaphDerivedManager {
    if (!this._derivedManager) {
      this._derivedManager = new RaphDerivedManager(
        () => this._dataAdapter,
        (records, errors) => this._publishDerived(records, errors),
      )
    }
    return this._derivedManager
  }

  /**
   * Выполняет внутреннюю операцию collect data observers.
   */
  private _collectDataObservers(): Set<RaphDataObserver<any>> {
    return new Set(this._dataObservers)
  }

  /**
   * Возвращает data adapter.
   */
  get dataAdapter(): DataAdapter {
    return this._dataAdapter
  }

  /**
   * Возвращает root data.
   */
  get data(): DataObject {
    return this._dataAdapter.root()
  }
}
