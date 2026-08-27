import type { RaphRuntime } from '@/domain/core/RaphRuntime'
import type { RaphDerivedNode } from '@/domain/derived/RaphDerivedNode'
import type { DataAdapter, DataPathDef } from '@/domain/types/base.types'
import type {
  RaphDerivedDisposeTarget,
  RaphDerivedKey,
  RaphDerivedManagerSnapshot,
  RaphDerivedMutationRecord,
  RaphDerivedOptions,
  RaphDerivedStrategy,
} from '@/domain/types/derived.types'
import { RaphRouter } from '@/domain/core/RaphRouter'
import {
  canonicalDerivedPath,
  collectionMutationImpact,
  derivedRoute,
  keyedPath,
  pathsOverlap,
} from '@/domain/derived/derived-path'
import { RaphDerivedHandle } from '@/domain/derived/RaphDerivedHandle'
import { RaphDerivedNode as DerivedNode } from '@/domain/derived/RaphDerivedNode'
import { DataPath } from '@/domain/entities/DataPath'
import { DepGraph } from '@/domain/entities/DepGraph'
import {
  RaphDerivedComputeError,
  RaphDerivedCycleError,
  RaphDerivedDisposedError,
  RaphDerivedError,
  RaphDerivedPathError,
  RaphDerivedReentrancyError,
  RaphDerivedStrategyError,
  RaphDerivedTargetWriteError,
} from '@/domain/types/derived.types'

interface DerivedRegistration {
  id: string
  publicId: string
  runtime: RaphRuntime<any>
  node: RaphDerivedNode
  handle: RaphDerivedHandle
  from: DataPath
  to: DataPath
  strategy: RaphDerivedStrategy
  compute: ((source: unknown) => unknown) | null
  disposeTarget: RaphDerivedDisposeTarget
  stale: boolean
  sourceIndex: Map<RaphDerivedKey, number> | null
  targetIndex: Map<RaphDerivedKey, number> | null
}

interface DirtyDerived {
  full: boolean
  keys: Set<RaphDerivedKey>
  invalidate: boolean
}

interface StabilizationResult {
  records: RaphDerivedMutationRecord[]
  errors: Error[]
}

type Publish = (records: RaphDerivedMutationRecord[], errors: Error[]) => void

/** Kernel-scoped registry и синхронный stabilizer materialized dependencies. */
export class RaphDerivedManager {
  private readonly _registrations = new Map<string, DerivedRegistration>()
  private readonly _publicIds = new Set<string>()
  private readonly _sourceRouter = new RaphRouter<DerivedRegistration>()
  private readonly _targetRouter = new RaphRouter<DerivedRegistration>()
  private readonly _graph = new DepGraph<DerivedRegistration>()
  private readonly _dirty = new Map<string, DirtyDerived>()
  private _counter = 0
  private _stabilizing = false

  public constructor(
    private readonly _getAdapter: () => DataAdapter,
    private readonly _publish: Publish,
  ) {}

  /** Создает системную ноду и регистрирует derived dependency в shared kernel graph. */
  public register<TSource, TTarget>(
    runtime: RaphRuntime<any>,
    options: RaphDerivedOptions<TSource, TTarget>,
  ): RaphDerivedHandle {
    this._assertRegistryMutable()
    const publicId = String(options.id ?? `derived-${this._counter++}`).trim()
    if (!publicId) {
      throw new RaphDerivedPathError('[RaphDerived] id must not be empty.')
    }
    if (this._publicIds.has(publicId)) {
      throw new RaphDerivedPathError(`[RaphDerived] Duplicate id: "${publicId}".`)
    }

    const from = canonicalDerivedPath(options.from, 'from')
    const to = canonicalDerivedPath(options.to, 'to')
    if (pathsOverlap(from, to)) {
      throw new RaphDerivedPathError('[RaphDerived] from and to paths must not overlap.')
    }
    if (this._targetRouter.matchIncludingPrefix(to).size) {
      throw new RaphDerivedTargetWriteError(`[RaphDerived] Target already has an active writer: "${to.toStringPath()}".`)
    }

    const strategy = options.strategy ?? Object.freeze({ kind: 'full' as const })
    const internalId = `${runtime.id}:${publicId}`
    const node = new DerivedNode(
      runtime,
      `__derived.${publicId}`,
      publicId,
      from.toStringPath(),
      to.toStringPath(),
      strategy,
    )
    // Derived-нода всегда является системным ребенком runtime root. Default Raph
    // может еще не быть init()-нут, поэтому root регистрируется лениво вместе с
    // первой derived-нODE, не запуская остальной runtime lifecycle.
    if (!runtime.graph.hasNode(runtime.root)) {
      runtime.registerNode(runtime.root)
    }
    runtime.root.addChild(node, { invalidate: false })
    const handle = new RaphDerivedHandle(
      publicId,
      node,
      internalId,
      options.disposeTarget ?? 'keep',
      this,
    )
    const registration: DerivedRegistration = {
      id: internalId,
      publicId,
      runtime,
      node,
      handle,
      from,
      to,
      strategy,
      compute: options.compute as (source: unknown) => unknown,
      disposeTarget: options.disposeTarget ?? 'keep',
      stale: false,
      sourceIndex: null,
      targetIndex: null,
    }

    try {
      this._registerGraph(registration)
      node.bindDispose(() => this.dispose(internalId))
      if (options.immediate !== false) {
        this.recompute(internalId)
      }
      return handle
    }
    catch (error) {
      if (this._registrations.has(internalId)) {
        try {
          node.dispose()
        }
        catch {
          // исходная registration/compute ошибка важнее cleanup ошибки
        }
      }
      else {
        node.dispose()
      }
      throw error
    }
  }

  /** Выполняет полный пересчет handle и downstream stabilization. */
  public recompute(id: string): void {
    this._assertRegistryMutable()
    const registration = this._requireRegistration(id)
    const result = this._executeDirectFull(registration)
    this._publish(result.records, result.errors)
  }

  public pause(id: string): void {
    this._assertRegistryMutable()
    const registration = this._requireRegistration(id)
    registration.node.markPaused()
  }

  public resume(id: string): void {
    this._assertRegistryMutable()
    const registration = this._requireRegistration(id)
    registration.node.markActive()
    registration.stale = false
    this.recompute(id)
  }

  /** Снимает регистрацию; target сохраняется по умолчанию. */
  public dispose(id: string): void {
    this._assertRegistryMutable()
    const registration = this._registrations.get(id)
    if (!registration) {
      return
    }

    this._sourceRouter.remove(derivedRoute(registration.from), registration)
    this._targetRouter.remove(derivedRoute(registration.to), registration)
    this._graph.removeNode(registration)
    this._registrations.delete(id)
    this._publicIds.delete(registration.publicId)
    this._dirty.delete(id)
    registration.compute = null
    registration.sourceIndex = null
    registration.targetIndex = null
    registration.node.markDisposed()
    registration.handle.detachManager()

    if (registration.disposeTarget === 'delete') {
      this._adapter.delete(registration.to)
      const record = this._record('derived', registration.to, registration.to, undefined, id)
      const result = this.stabilize([record])
      this._publish(result.records, result.errors)
    }
  }

  /** Стабилизирует все affected derives и возвращает target mutations для обычной доставки. */
  public stabilize(input: RaphDerivedMutationRecord[]): StabilizationResult {
    if (!input.length || !this._registrations.size) {
      return { records: input, errors: [] }
    }
    if (this._stabilizing) {
      throw new RaphDerivedReentrancyError('[RaphDerived] Reentrant stabilization is forbidden.')
    }

    this._stabilizing = true
    const records = [...input]
    const errors: Error[] = []
    try {
      for (const mutation of input) {
        this._ingestMutation(mutation)
      }

      while (this._dirty.size) {
        const registration = this._nextDirtyRegistration()
        const dirty = this._dirty.get(registration.id)!
        this._dirty.delete(registration.id)

        try {
          const produced = dirty.full || registration.strategy.kind === 'full'
            ? this._executeFull(registration, dirty.invalidate)
            : this._executeIncremental(registration, dirty.keys, dirty.invalidate)
          registration.node.markActive()
          registration.stale = false
          for (const mutation of produced) {
            records.push(mutation)
            this._ingestMutation(mutation)
          }
        }
        catch (cause) {
          const error = cause instanceof RaphDerivedError
            ? cause
            : new RaphDerivedComputeError(registration.publicId, cause)
          registration.node.markError(error)
          errors.push(error)
        }
      }
      return { records, errors }
    }
    finally {
      this._dirty.clear()
      this._stabilizing = false
    }
  }

  /** Запрещает reentrant compute writes и внешние записи в materialized targets. */
  public assertExternalMutationAllowed(path: DataPathDef): void {
    if (this._stabilizing) {
      throw new RaphDerivedReentrancyError('[RaphDerived] Store mutation during compute/stabilization is forbidden.')
    }
    const canonical = DataPath.from(path)
    const targets = this._targetRouter.matchIncludingPrefix(canonical)
    if (targets.size) {
      const target = targets.values().next().value as DerivedRegistration
      throw new RaphDerivedTargetWriteError(`[RaphDerived] Target "${target.to.toStringPath()}" is read-only while derive "${target.publicId}" is active.`)
    }
  }

  public disposeRuntime(runtime: RaphRuntime<any>): void {
    const handles = [...this._registrations.values()]
      .filter(registration => registration.runtime === runtime)
      .map(registration => registration.handle)
    for (const handle of handles) {
      handle.dispose()
    }
  }

  public disposeAll(): void {
    for (const handle of [...this._registrations.values()].map(item => item.handle)) {
      handle.dispose()
    }
  }

  public snapshot(): RaphDerivedManagerSnapshot {
    let graphEdges = 0
    for (const registration of this._graph.topoOrder()) {
      graphEdges += this._graph.childrenOf(registration).size
    }
    let pendingKeys = 0
    for (const dirty of this._dirty.values()) {
      pendingKeys += dirty.keys.size
    }
    return {
      registrations: this._registrations.size,
      graphNodes: this._graph.size(),
      graphEdges,
      sourceRoutes: this._registrations.size,
      targetRoutes: this._registrations.size,
      dirtyHandles: this._dirty.size,
      pendingKeys,
      errors: [...this._registrations.values()].filter(item => item.node.status === 'error').length,
      stabilizing: this._stabilizing,
    }
  }

  public get size(): number {
    return this._registrations.size
  }

  private get _adapter(): DataAdapter {
    return this._getAdapter()
  }

  private _registerGraph(registration: DerivedRegistration): void {
    const upstream = this._targetRouter.matchIncludingPrefix(registration.from)
    const downstream = this._sourceRouter.matchIncludingPrefix(registration.to)

    this._registrations.set(registration.id, registration)
    this._publicIds.add(registration.publicId)
    this._graph.addNode(registration)
    this._sourceRouter.add(derivedRoute(registration.from), registration)
    this._targetRouter.add(derivedRoute(registration.to), registration)

    for (const parent of upstream) {
      // Новая нода еще не имеет outgoing edges, поэтому upstream edge сам по
      // себе не может замкнуть цикл. Цикл проявится при добавлении downstream.
      this._graph.addEdge(parent, registration)
    }
    for (const child of downstream) {
      if (child === registration) {
        continue
      }
      if (!this._graph.addEdge(registration, child)) {
        this._rollbackRegistration(registration)
        throw new RaphDerivedCycleError(`[RaphDerived] Cycle detected near "${registration.publicId}".`)
      }
    }
  }

  private _rollbackRegistration(registration: DerivedRegistration): void {
    this._sourceRouter.remove(derivedRoute(registration.from), registration)
    this._targetRouter.remove(derivedRoute(registration.to), registration)
    this._graph.removeNode(registration)
    this._registrations.delete(registration.id)
    this._publicIds.delete(registration.publicId)
  }

  private _executeDirectFull(registration: DerivedRegistration): StabilizationResult {
    let first: RaphDerivedMutationRecord[] = []
    const errors: Error[] = []
    this._stabilizing = true
    try {
      first = this._executeFull(registration, true)
      registration.node.markActive()
    }
    catch (cause) {
      const error = cause instanceof RaphDerivedError
        ? cause
        : new RaphDerivedComputeError(registration.publicId, cause)
      registration.node.markError(error)
      errors.push(error)
    }
    finally {
      this._stabilizing = false
    }
    if (!first.length) {
      return { records: [], errors }
    }
    const downstream = this.stabilize(first)
    return { records: downstream.records, errors: [...errors, ...downstream.errors] }
  }

  private _executeFull(registration: DerivedRegistration, invalidate: boolean): RaphDerivedMutationRecord[] {
    const source = this._adapter.get(registration.from)
    const output = this._callCompute(registration, source, 'full')
    const unmaterializedCollection = registration.strategy.kind !== 'full'
      && source === undefined
      && (output === undefined || (Array.isArray(output) && output.length === 0))
    if (registration.strategy.kind !== 'full' && !unmaterializedCollection) {
      this._validateCollectionResult(registration, source, output)
    }
    const materialized = registration.strategy.kind === 'filter-by-key'
      ? cloneMaterializedValue(output)
      : output
    this._adapter.set(registration.to, materialized)
    if (registration.strategy.kind !== 'full') {
      registration.sourceIndex = unmaterializedCollection
        ? new Map()
        : collectionIndex(source as unknown[], registration.strategy.key, 'source')
      registration.targetIndex = unmaterializedCollection
        ? new Map()
        : collectionIndex(materialized as unknown[], registration.strategy.key, 'output')
    }
    registration.node.countTargetWrites(1)
    return [this._record('derived', registration.to, registration.to, { invalidate }, registration.id)]
  }

  private _executeIncremental(
    registration: DerivedRegistration,
    keys: Set<RaphDerivedKey>,
    invalidate: boolean,
  ): RaphDerivedMutationRecord[] {
    if (registration.strategy.kind === 'filter-by-key') {
      return this._executeIncrementalFilter(registration, keys, invalidate)
    }

    const strategy = registration.strategy as Extract<RaphDerivedStrategy, { kind: 'collection-by-key' }>
    const keyField = strategy.key
    const source = this._adapter.get(registration.from)
    const target = this._adapter.get(registration.to)
    if (!Array.isArray(source) || !Array.isArray(target)) {
      throw new RaphDerivedStrategyError('[RaphDerived] collectionByKey requires array source and target.')
    }

    if (!registration.sourceIndex || indexesAreStale(source, keyField, registration.sourceIndex, keys)) {
      registration.sourceIndex = collectionIndex(source, keyField, 'source')
    }
    const targetIndex = registration.targetIndex!
    const existing: Array<{ key: RaphDerivedKey, index: number, item: unknown }> = []
    const deleted: RaphDerivedKey[] = []
    for (const key of keys) {
      const index = registration.sourceIndex.get(key)
      if (index === undefined) {
        deleted.push(key)
        continue
      }
      existing.push({ key, index, item: source[index] })
    }
    existing.sort((left, right) => left.index - right.index)

    const input = existing.map(entry => entry.item)
    const output = input.length ? this._callCompute(registration, input, 'incremental') : []
    this._validateIncrementalResult(registration, existing.map(entry => entry.key), output)

    const records: RaphDerivedMutationRecord[] = []
    const result = output as unknown[]
    const structural = deleted.length > 0 || existing.some(entry => !targetIndex.has(entry.key))

    if (structural) {
      const replacements = new Map<RaphDerivedKey, unknown>()
      for (let index = 0; index < existing.length; index++) {
        replacements.set(existing[index].key, result[index])
      }
      const oldItems = new Map<RaphDerivedKey, unknown>()
      for (const [key, index] of targetIndex) {
        oldItems.set(key, target[index])
      }

      const sourceKeys = collectionKeys(source, keyField, 'source')
      const nextTarget = new Array<unknown>(sourceKeys.length)
      for (let position = 0; position < sourceKeys.length; position++) {
        const key = sourceKeys[position]
        // DefaultDataAdapter может удалять array item через unset, сохраняя hole.
        if (key === undefined) {
          continue
        }
        const item = replacements.has(key) ? replacements.get(key) : oldItems.get(key)
        if (item === undefined) {
          throw new RaphDerivedStrategyError(`[RaphDerived] Missing materialized target item for key "${String(key)}".`)
        }
        nextTarget[position] = item
      }
      this._adapter.set(registration.to, nextTarget)
      registration.targetIndex = collectionIndex(nextTarget, keyField, 'target')
    }
    else {
      for (let index = 0; index < existing.length; index++) {
        const path = keyedPath(registration.to, keyField, existing[index].key)
        this._adapter.set(path, result[index])
      }
    }

    for (const entry of existing) {
      const path = keyedPath(registration.to, keyField, entry.key)
      records.push(this._record('derived', path, path, { invalidate }, registration.id))
    }
    for (const key of deleted) {
      const path = keyedPath(registration.to, keyField, key)
      records.push(this._record('derived', path, path, { invalidate }, registration.id))
    }
    registration.node.countTargetWrites(records.length)
    return records
  }

  /** Пересчитывает только затронутые строки row-local фильтра и обновляет membership по ключу. */
  private _executeIncrementalFilter(
    registration: DerivedRegistration,
    keys: Set<RaphDerivedKey>,
    invalidate: boolean,
  ): RaphDerivedMutationRecord[] {
    const strategy = registration.strategy as Extract<RaphDerivedStrategy, { kind: 'filter-by-key' }>
    const keyField = strategy.key
    const source = this._adapter.get(registration.from)
    const target = this._adapter.get(registration.to)
    if (!Array.isArray(source) || !Array.isArray(target)) {
      throw new RaphDerivedStrategyError('[RaphDerived] filterByKey requires array source and target.')
    }

    if (!registration.sourceIndex || indexesAreStale(source, keyField, registration.sourceIndex, keys)) {
      registration.sourceIndex = collectionIndex(source, keyField, 'source')
    }
    const targetIndex = registration.targetIndex!
    const existing: Array<{ key: RaphDerivedKey, index: number, item: unknown }> = []
    for (const key of keys) {
      const index = registration.sourceIndex.get(key)
      if (index !== undefined) {
        existing.push({ key, index, item: source[index] })
      }
    }
    existing.sort((left, right) => left.index - right.index)

    const input = existing.map(entry => entry.item)
    const output = input.length ? this._callCompute(registration, input, 'incremental') : []
    this._validateIncrementalResult(registration, existing.map(entry => entry.key), output)

    const result = output as unknown[]
    const accepted = new Map<RaphDerivedKey, unknown>()
    const outputKeys = collectionKeys(result, keyField, 'output')
    for (let index = 0; index < outputKeys.length; index++) {
      const key = outputKeys[index]
      if (key !== undefined) {
        accepted.set(key, cloneMaterializedValue(result[index]))
      }
    }

    const affected = new Set(keys)
    const changed = [...affected].filter(key => targetIndex.has(key) || accepted.has(key))
    const structural = changed.some(key => targetIndex.has(key) !== accepted.has(key))
    if (structural) {
      const oldItems = new Map<RaphDerivedKey, unknown>()
      for (const [key, index] of targetIndex) {
        oldItems.set(key, target[index])
      }

      const nextTarget: unknown[] = []
      for (const key of collectionKeys(source, keyField, 'source')) {
        if (key === undefined) {
          continue
        }
        if (affected.has(key)) {
          if (accepted.has(key)) {
            nextTarget.push(accepted.get(key))
          }
          continue
        }
        if (oldItems.has(key)) {
          nextTarget.push(oldItems.get(key))
        }
      }
      this._adapter.set(registration.to, nextTarget)
      registration.targetIndex = collectionIndex(nextTarget, keyField, 'target')
    }
    else {
      for (const [key, item] of accepted) {
        this._adapter.set(keyedPath(registration.to, keyField, key), item)
      }
    }

    const records = changed.map((key) => {
      const path = keyedPath(registration.to, keyField, key)
      return this._record('derived', path, path, { invalidate }, registration.id)
    })
    registration.node.countTargetWrites(records.length)
    return records
  }

  private _callCompute(
    registration: DerivedRegistration,
    source: unknown,
    mode: 'full' | 'incremental',
  ): unknown {
    registration.node.countCompute(mode)
    let output: unknown
    try {
      output = registration.compute!(source)
    }
    catch (cause) {
      throw new RaphDerivedComputeError(registration.publicId, cause)
    }
    if (isThenable(output)) {
      throw new RaphDerivedStrategyError('[RaphDerived] Async compute is not supported.')
    }
    return output
  }

  private _validateCollectionResult(
    registration: DerivedRegistration,
    source: unknown,
    output: unknown,
  ): void {
    if (!Array.isArray(source) || !Array.isArray(output)) {
      throw new RaphDerivedStrategyError(
        `[RaphDerived] collectionByKey "${registration.publicId}" requires array source and output.`,
      )
    }
    if (registration.strategy.kind === 'collection-by-key' && source.length !== output.length) {
      throw new RaphDerivedStrategyError('[RaphDerived] collectionByKey must preserve collection cardinality.')
    }
    const key = registration.strategy.kind === 'full' ? '' : registration.strategy.key
    const sourceKeys = collectionKeys(source, key, 'source')
    const outputKeys = collectionKeys(output, key, 'output')
    if (registration.strategy.kind === 'collection-by-key') {
      for (let index = 0; index < sourceKeys.length; index++) {
        if (sourceKeys[index] !== outputKeys[index]) {
          throw new RaphDerivedStrategyError('[RaphDerived] collectionByKey must preserve key order.')
        }
      }
      return
    }

    const sourcePositions = new Map<RaphDerivedKey, number>()
    sourceKeys.forEach((sourceKey, index) => {
      if (sourceKey !== undefined) {
        sourcePositions.set(sourceKey, index)
      }
    })
    let previousPosition = -1
    for (const outputKey of outputKeys) {
      if (outputKey === undefined) {
        continue
      }
      const position = sourcePositions.get(outputKey)
      if (position === undefined || position <= previousPosition) {
        throw new RaphDerivedStrategyError('[RaphDerived] filterByKey output must be an ordered subset of source.')
      }
      previousPosition = position
    }
  }

  private _validateIncrementalResult(
    registration: DerivedRegistration,
    inputKeys: RaphDerivedKey[],
    output: unknown,
  ): void {
    if (!Array.isArray(output)) {
      throw new RaphDerivedStrategyError('[RaphDerived] Incremental collection compute must return an array.')
    }
    if (registration.strategy.kind === 'collection-by-key' && inputKeys.length !== output.length) {
      throw new RaphDerivedStrategyError('[RaphDerived] Incremental collection compute must preserve cardinality.')
    }
    const key = registration.strategy.kind === 'full' ? '' : registration.strategy.key
    const outputKeys = collectionKeys(output, key, 'output')
    if (registration.strategy.kind === 'collection-by-key') {
      for (let index = 0; index < inputKeys.length; index++) {
        if (inputKeys[index] !== outputKeys[index]) {
          throw new RaphDerivedStrategyError('[RaphDerived] Incremental collection compute must preserve key order.')
        }
      }
      return
    }

    const inputPositions = new Map(inputKeys.map((keyValue, index) => [keyValue, index]))
    let previousPosition = -1
    for (const outputKey of outputKeys) {
      if (outputKey === undefined) {
        continue
      }
      const position = inputPositions.get(outputKey)
      if (position === undefined || position <= previousPosition) {
        throw new RaphDerivedStrategyError('[RaphDerived] Incremental filter output must be an ordered subset of input.')
      }
      previousPosition = position
    }
  }

  private _ingestMutation(mutation: RaphDerivedMutationRecord): void {
    for (const registration of this._sourceRouter.matchIncludingPrefix(mutation.path)) {
      if (registration.node.status === 'paused') {
        registration.stale = true
        registration.node.markStale()
        continue
      }

      const dirty = this._dirty.get(registration.id) ?? {
        full: false,
        keys: new Set<RaphDerivedKey>(),
        invalidate: false,
      }
      dirty.invalidate ||= mutation.opts?.invalidate ?? true
      if (
        registration.strategy.kind === 'full'
        || registration.node.status === 'error'
        || !registration.sourceIndex
        || !registration.targetIndex
      ) {
        dirty.full = true
      }
      else if (!dirty.full) {
        const impact = collectionMutationImpact(registration.from, registration.strategy.key, mutation)
        if (impact.kind === 'full') {
          dirty.full = true
          dirty.keys.clear()
        }
        else {
          dirty.keys.add(impact.key)
        }
      }
      this._dirty.set(registration.id, dirty)
    }
  }

  private _nextDirtyRegistration(): DerivedRegistration {
    return this._graph.topoOrder().find(registration => this._dirty.has(registration.id))!
  }

  private _record(
    kind: RaphDerivedMutationRecord['kind'],
    path: DataPathDef,
    originalPath: DataPathDef,
    opts?: RaphDerivedMutationRecord['opts'],
    originDerivedId?: string,
  ): RaphDerivedMutationRecord {
    return {
      kind,
      path: DataPath.from(path),
      originalPath,
      opts,
      originDerivedId,
    }
  }

  private _requireRegistration(id: string): DerivedRegistration {
    const registration = this._registrations.get(id)
    if (!registration) {
      throw new RaphDerivedDisposedError(`[RaphDerived] Registration "${id}" is disposed.`)
    }
    return registration
  }

  private _assertRegistryMutable(): void {
    if (this._stabilizing) {
      throw new RaphDerivedReentrancyError('[RaphDerived] Registry mutation during stabilization is forbidden.')
    }
  }
}

function collectionKeys(collection: unknown[], key: string, label: string): Array<RaphDerivedKey | undefined> {
  const seen = new Set<RaphDerivedKey>()
  const keys: Array<RaphDerivedKey | undefined> = []
  for (let index = 0; index < collection.length; index++) {
    if (!(index in collection)) {
      keys.push(undefined)
      continue
    }
    const item = collection[index]
    if (!isPlainObject(item)) {
      throw new RaphDerivedStrategyError(`[RaphDerived] ${label} collection items must be objects.`)
    }
    const value = item[key]
    if (typeof value !== 'string' && typeof value !== 'number') {
      throw new RaphDerivedStrategyError(`[RaphDerived] ${label} item key "${key}" must be a string or number.`)
    }
    if (seen.has(value)) {
      throw new RaphDerivedStrategyError(`[RaphDerived] Duplicate ${label} key: "${String(value)}".`)
    }
    seen.add(value)
    keys.push(value)
  }
  return keys
}

function collectionIndex(collection: unknown[], key: string, label: string): Map<RaphDerivedKey, number> {
  const keys = collectionKeys(collection, key, label)
  const index = new Map<RaphDerivedKey, number>()
  for (let position = 0; position < keys.length; position++) {
    if (keys[position] !== undefined) {
      index.set(keys[position]!, position)
    }
  }
  return index
}

function indexesAreStale(
  collection: unknown[],
  keyField: string,
  index: Map<RaphDerivedKey, number>,
  affectedKeys: Set<RaphDerivedKey>,
): boolean {
  for (const key of affectedKeys) {
    const position = index.get(key)
    if (position === undefined) {
      return true
    }
    const item = collection[position]
    if (!isPlainObject(item) || item[keyField] !== key) {
      return true
    }
  }
  return false
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return Boolean(value && (typeof value === 'object' || typeof value === 'function') && typeof (value as any).then === 'function')
}

/** Отделяет materialized filter target от source даже при identity predicate `rows.filter(...)`. */
function cloneMaterializedValue<T>(value: T): T {
  try {
    return structuredClone(value)
  }
  catch {
    return cloneFallback(value, new WeakMap<object, unknown>())
  }
}

function cloneFallback<T>(value: T, seen: WeakMap<object, unknown>): T {
  if (value === null || typeof value !== 'object') {
    return value
  }
  const cached = seen.get(value)
  if (cached !== undefined) {
    return cached as T
  }
  if (value instanceof Date) {
    return new Date(value.getTime()) as T
  }
  if (Array.isArray(value)) {
    const result: unknown[] = []
    seen.set(value, result)
    for (let index = 0; index < value.length; index++) {
      if (index in value) {
        result[index] = cloneFallback(value[index], seen)
      }
    }
    return result as T
  }
  const result = Object.create(Object.getPrototypeOf(value)) as Record<PropertyKey, unknown>
  seen.set(value, result)
  for (const key of Reflect.ownKeys(value)) {
    result[key] = cloneFallback((value as Record<PropertyKey, unknown>)[key], seen)
  }
  return result as T
}
