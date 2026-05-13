import { RaphRuntime } from '@/domain/core/RaphRuntime'
import { RaphRouter } from '@/domain/core/RaphRouter'
import { DefaultDataAdapter } from '@/domain/entities/data-adapter'
import { DataPath } from '@/domain/entities/DataPath'
import type {
  DataAdapter,
  DataObject,
  DataPathDef,
  RaphProperties,
} from '@/domain/types/base.types'
import type {
  RaphDataObserver,
  RaphKernelPendingEvent,
  RaphObserveDataOptions,
  RaphRuntimeOptions,
} from '@/domain/types/runtime.types'

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
  private readonly _pendingEvents: Array<RaphKernelPendingEvent> = []

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
    this.removeDataObserversByRuntime(runtime)
    this._runtimes.delete(runtime)
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
    this._transactionDepth++
    try {
      fn()
    } finally {
      this._transactionDepth--
      if (this._transactionDepth === 0) {
        this._flushPendingEvents()
      }
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
    this._dataAdapter.set(path, value, opts)
    this.notify(path, opts)
  }

  /**
   * Сливает значение по пути.
   */
  merge(
    path: DataPathDef,
    value: unknown,
    opts?: { invalidate?: boolean, vars?: Record<string, any> },
  ): void {
    this._dataAdapter.merge(path, value, opts)
    this.notify(path, opts)
  }

  /**
   * Удаляет значение по пути.
   */
  delete(
    path: DataPathDef,
    opts?: { invalidate?: boolean, vars?: Record<string, any> },
  ): void {
    this._dataAdapter.delete(path, opts)
    this.notify(path, opts)
  }

  /**
   * Доставляет событие изменения данных runtime lanes.
   */
  notify(
    path: DataPathDef,
    opts?: { invalidate?: boolean, vars?: Record<string, any> },
  ): void {
    if (this._transactionDepth > 0) {
      this._pendingEvents.push({ path, opts })
      return
    }

    this._deliverEvents([{ path, opts }])
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

    const events = this._pendingEvents.splice(0)
    this._deliverEvents(events)
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
          if (invalidate) runtimesToInvalidate.add(observer.runtime)
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
