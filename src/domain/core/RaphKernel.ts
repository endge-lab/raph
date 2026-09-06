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
  RaphMetaMutationCause,
  RaphMetaObserver,
  RaphMetaReadOptions,
  RaphMetaWriteOptions,
  RaphObserveMetaOptions,
  RaphPendingMetaMutationEvent,
} from '@/domain/types/meta.types'
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
import { RaphMeta } from '@/domain/meta/RaphMeta'
import { RaphMetaStore } from '@/domain/meta/RaphMetaStore'
import { RaphMetaWatch } from '@/domain/reactivity/RaphMetaWatch'
import { SegKind } from '@/domain/types/path.types'

/**
 * Управляет shared data-store и маршрутизацией business data events между runtime lanes.
 */
export class RaphKernel {
  readonly id: string

  private _dataAdapter: DataAdapter
  private readonly _runtimes = new Set<RaphRuntime<any>>()
  private readonly _dataObservers = new Set<RaphDataObserver<any>>()
  private readonly _dataObserverRouter = new RaphRouter<RaphDataObserver<any>>()
  private readonly _metaStore = new RaphMetaStore()
  private readonly _metaObservers = new Set<RaphMetaObserver<any>>()
  private readonly _metaObserverRouter = new RaphRouter<RaphMetaObserver<any>>()
  private readonly _meta: RaphMeta
  private _dataObserverCounter = 0
  private _metaObserverCounter = 0
  private _transactionDepth = 0
  private readonly _pendingEvents: Array<RaphDerivedMutationRecord> = []
  private readonly _pendingMetaEvents: RaphPendingMetaMutationEvent[] = []
  private _derivedManager: RaphDerivedManager | null = null

  /**
   * Создает instance и подготавливает shared data-store.
   */
  constructor(options: { id?: string, adapter?: DataAdapter } = {}) {
    this.id = options.id ?? 'kernel'
    this._dataAdapter = options.adapter ?? new DefaultDataAdapter()
    this._meta = new RaphMeta(this)
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
    this.removeMetaObserversByRuntime(runtime)
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

  /** Регистрирует observer отдельного Meta-plane. */
  registerMetaObserver<Props extends RaphProperties>(
    runtime: RaphRuntime<Props>,
    node: RaphMetaObserver<Props>['node'],
    mask: DataPathDef,
    options: RaphObserveMetaOptions,
  ): () => void {
    if (options.namespace !== undefined) {
      this._assertNamespace(options.namespace)
    }
    const observer: RaphMetaObserver<Props> = {
      id: `__metaObserver.${this._metaObserverCounter++}`,
      runtime,
      node,
      mask,
      phase: options.phase,
      traversal: options.traversal,
      namespace: options.namespace,
      vars: options.vars,
      wildcardDynamic: options.wildcardDynamic,
    }
    const route = DataPath.from(mask, {
      vars: options.vars,
      wildcardDynamic: options.wildcardDynamic,
    })
    this._metaObserverRouter.add(route, observer)
    this._metaObservers.add(observer)
    return () => {
      this._metaObserverRouter.remove(route, observer)
      this._metaObservers.delete(observer)
    }
  }

  /** Снимает все Meta observers runtime lane. */
  removeMetaObserversByRuntime(runtime: RaphRuntime<any>): void {
    for (const observer of [...this._metaObservers]) {
      if (observer.runtime === runtime) {
        this._metaObserverRouter.removePayload(observer)
        this._metaObservers.delete(observer)
      }
    }
  }

  /** Снимает Meta observers конкретной runtime-ноды. */
  removeMetaObserversByNode(runtime: RaphRuntime<any>, node: RaphMetaObserver['node']): void {
    for (const observer of [...this._metaObservers]) {
      if (observer.runtime === runtime && observer.node === node) {
        this._metaObserverRouter.removePayload(observer)
        this._metaObservers.delete(observer)
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

  /** Проверяет существование data owner, сохраняя различие с undefined value. */
  has(path: DataPathDef, opts?: { vars?: Record<string, any> }): boolean {
    if (this._dataAdapter.has) {
      return this._dataAdapter.has(path, opts)
    }
    return adapterHasFallback(this._dataAdapter, path, opts)
  }

  /** Читает metadata одного namespace либо все namespaces exact data path. */
  getMeta(path: DataPathDef, namespace?: string, options?: RaphMetaReadOptions): unknown {
    if (namespace !== undefined) {
      this._assertNamespace(namespace)
    }
    return this._metaStore.get(this._metaPath(path, options), namespace)
  }

  /** Проверяет наличие metadata exact data path. */
  hasMeta(path: DataPathDef, namespace?: string, options?: RaphMetaReadOptions): boolean {
    if (namespace !== undefined) {
      this._assertNamespace(namespace)
    }
    return this._metaStore.has(this._metaPath(path, options), namespace)
  }

  /** Устанавливает пользовательскую metadata существующего data owner. */
  setMeta(path: DataPathDef, namespace: string, value: unknown, options?: RaphMetaWriteOptions): void {
    this._assertNamespace(namespace)
    const canonical = this._metaPath(path, options)
    this._assertExactMetaPath(canonical)
    this._assertMetaOwner(canonical)
    this._metaStore.set(canonical, namespace, value)
    this._recordMetaMutation('set', canonical, namespace, 'explicit', options)
  }

  /** Объединяет пользовательскую metadata существующего data owner. */
  mergeMeta(path: DataPathDef, namespace: string, value: unknown, options?: RaphMetaWriteOptions): void {
    this._assertNamespace(namespace)
    const canonical = this._metaPath(path, options)
    this._assertExactMetaPath(canonical)
    this._assertMetaOwner(canonical)
    this._metaStore.merge(canonical, namespace, value)
    this._recordMetaMutation('merge', canonical, namespace, 'explicit', options)
  }

  /** Удаляет namespace exact path либо metadata всего адресного поддерева. */
  deleteMeta(path: DataPathDef, namespace?: string, options?: RaphMetaWriteOptions): void {
    if (namespace !== undefined) {
      this._assertNamespace(namespace)
    }
    const canonical = this._metaPath(path, options)
    this._assertExactMetaPath(canonical)
    const removed = this._metaStore.delete(canonical, namespace)
    for (const removedPath of removed) {
      this._recordMetaMutation('delete', removedPath, namespace ?? null, 'explicit', options)
    }
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
    if (this._metaStore.size === 0) {
      this._dataAdapter.set(path, value, opts)
      this._recordMutation('set', path, opts)
      return
    }
    this._mutateWithMetaLifecycle(() => {
      this._dataAdapter.set(path, value, opts)
      this._recordMutation('set', path, opts)
      this._pruneReplacedOwners(path, opts)
    })
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
    if (this._metaStore.size === 0) {
      this._dataAdapter.merge(path, value, opts)
      this._recordMutation('merge', path, opts)
      return
    }
    this._mutateWithMetaLifecycle(() => {
      this._dataAdapter.merge(path, value, opts)
      this._recordMutation('merge', path, opts)
      this._pruneReplacedOwners(path, opts)
    })
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
    if (this._metaStore.size === 0) {
      this._dataAdapter.delete(path, opts)
      this._recordMutation('delete', path, opts)
      return
    }
    this._mutateWithMetaLifecycle(() => {
      this._dataAdapter.delete(path, opts)
      this._recordMutation('delete', path, opts)
      const canonical = DataPath.from(path, { vars: opts?.vars })
      for (const removedPath of this._metaStore.deleteSubtree(canonical)) {
        this._recordMetaMutation('delete', removedPath, null, 'owner-delete', opts)
      }
      for (const removedPath of this._metaStore.pruneMissingSiblings(canonical, candidate => this.has(candidate))) {
        this._recordMetaMutation('delete', removedPath, null, 'owner-delete', opts)
      }
    })
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
    const removedPaths = this._metaStore.clear()
    if (removedPaths.length) {
      this.transaction(() => {
        for (const path of removedPaths) {
          this._recordMetaMutation('delete', path, null, 'clear')
        }
      })
    }
  }

  /**
   * Очищает shared data и observers.
   */
  clear(): void {
    const root = this._dataAdapter.root()
    for (const key of Object.keys(root)) {
      delete root[key]
    }
    this._metaStore.clear()
    this._pendingEvents.length = 0
    this._pendingMetaEvents.length = 0
    this._transactionDepth = 0
  }

  /**
   * Выполняет внутреннюю операцию flush pending events.
   */
  private _flushPendingEvents(): void {
    if (this._pendingEvents.length === 0 && this._pendingMetaEvents.length === 0) {
      return
    }
    const mutations = this._pendingEvents.splice(0)
    const metaEvents = this._pendingMetaEvents.splice(0)
    const runtimesToInvalidate = new Set<RaphRuntime<any>>()
    let errors: Error[] = []
    if (mutations.length) {
      const result = this._derivedManager?.size
        ? this._derivedManager.stabilize(mutations)
        : { records: mutations, errors: [] }
      errors = result.errors
      this._deliverEvents(result.records.map(record => ({
        path: record.originalPath,
        opts: record.opts,
      })), runtimesToInvalidate, false)
    }
    this._deliverMetaEvents(metaEvents, runtimesToInvalidate, false)
    for (const runtime of runtimesToInvalidate) {
      runtime.invalidate()
    }
    this._throwDerivedErrors(errors)
  }

  /**
   * Выполняет внутреннюю операцию deliver events.
   */
  private _deliverEvents(
    events: Array<RaphKernelPendingEvent>,
    runtimesToInvalidate = new Set<RaphRuntime<any>>(),
    invalidateRuntimes = true,
  ): void {
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

    if (invalidateRuntimes) {
      for (const runtime of runtimesToInvalidate) {
        runtime.invalidate()
      }
    }
  }

  /** Доставляет Meta events только Meta observers, не затрагивая derived/data routes. */
  private _deliverMetaEvents(
    events: RaphPendingMetaMutationEvent[],
    runtimesToInvalidate = new Set<RaphRuntime<any>>(),
    invalidateRuntimes = true,
  ): void {
    for (const event of events) {
      const observers = this._metaObserverRouter.match(event.path)
      for (const observer of observers) {
        if (observer.namespace !== undefined && observer.namespace !== event.namespace && event.namespace !== null) {
          continue
        }
        if (observer.node instanceof RaphMetaWatch) {
          observer.node.enqueue(event)
        }
        if (observer.runtime.enqueueMetaObserver(observer, event) && event.invalidate) {
          runtimesToInvalidate.add(observer.runtime)
        }
      }
    }
    if (invalidateRuntimes) {
      for (const runtime of runtimesToInvalidate) {
        runtime.invalidate()
      }
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

  private _recordMetaMutation(
    kind: RaphPendingMetaMutationEvent['kind'],
    path: DataPath,
    namespace: string | null,
    cause: RaphMetaMutationCause,
    options?: RaphMetaWriteOptions,
  ): void {
    const event: RaphPendingMetaMutationEvent = {
      kind,
      path,
      namespace,
      cause,
      invalidate: options?.invalidate ?? true,
    }
    if (this._transactionDepth > 0) {
      this._pendingMetaEvents.push(event)
      return
    }
    this._deliverMetaEvents([event])
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
    this._throwDerivedErrors(errors)
  }

  private _throwDerivedErrors(errors: Error[]): void {
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

  private _mutateWithMetaLifecycle(mutate: () => void): void {
    if (this._transactionDepth > 0) {
      mutate()
      return
    }
    this.transaction(mutate)
  }

  private _pruneReplacedOwners(path: DataPathDef, options?: { invalidate?: boolean, vars?: Record<string, any> }): void {
    if (this._metaStore.size === 0) {
      return
    }
    const canonical = DataPath.from(path, { vars: options?.vars })
    for (const removedPath of this._metaStore.pruneMissing(canonical, candidate => this.has(candidate))) {
      this._recordMetaMutation('delete', removedPath, null, 'owner-replaced', options)
    }
  }

  private _metaPath(path: DataPathDef, options?: RaphMetaReadOptions): DataPath {
    return DataPath.from(path, { vars: options?.vars })
  }

  private _assertNamespace(namespace: string): void {
    if (!String(namespace ?? '').trim()) {
      throw new Error('[RaphMeta] namespace must not be empty.')
    }
  }

  private _assertExactMetaPath(path: DataPath): void {
    if (path.segments().some(segment => segment.kind === SegKind.Wildcard)) {
      throw new Error('[RaphMeta] wildcard paths are read-only observation masks.')
    }
  }

  private _assertMetaOwner(path: DataPath): void {
    if (!this.has(path)) {
      throw new Error(`[RaphMeta] Owner data path does not exist: "${path.toStringPath()}".`)
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

  /** Возвращает kernel-bound Meta facade; watch доступен через runtime-bound facade. */
  get meta(): RaphMeta {
    return this._meta
  }
}

function adapterHasFallback(
  adapter: DataAdapter,
  path: DataPathDef,
  options?: { vars?: Record<string, any> },
): boolean {
  const segments = DataPath.from(path, { vars: options?.vars }).segments()
  let current: any = adapter.root()
  for (const segment of segments) {
    if (current == null) {
      return false
    }
    switch (segment.kind) {
      case SegKind.Key:
        if ((typeof current !== 'object' && typeof current !== 'function') || !Object.hasOwn(current, segment.key as any)) {
          return false
        }
        current = current[segment.key as any]
        break
      case SegKind.Index:
        if (!Array.isArray(current) || !Object.hasOwn(current, segment.index as number)) {
          return false
        }
        current = current[segment.index as number]
        break
      case SegKind.Param: {
        if (!Array.isArray(current)) {
          return false
        }
        const index = current.findIndex(item => item != null && item[segment.pkey!] === segment.pval)
        if (index < 0) {
          return false
        }
        current = current[index]
        break
      }
      case SegKind.Wildcard:
        throw new Error('has: wildcard "*" без параметров не поддерживается')
    }
  }
  return true
}
