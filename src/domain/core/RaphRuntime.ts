import type { RaphKernel } from '@/domain/core/RaphKernel'
import type { RaphDerivedHandle } from '@/domain/derived/RaphDerivedHandle'
import type { RaphLocalPhaseRuntime } from '@/domain/local/raph-local-phase'
import type { RaphLocalPropertyRuntime } from '@/domain/local/raph-local-property'
import type {
  DataAdapter,
  DataObject,
  DataPathDef,
  PhaseDirty,
  RaphFrameContext,
  RaphLoopLease,
  RaphOptions,
  RaphPriorityStrategy,
  RaphProperties,
  RaphScheduler,
  Undefinable,
} from '@/domain/types/base.types'
import type {
  ControlFlowCallback,
  ControlFlowSubscribeOptions,
  ControlFlowSubscriptionId,
} from '@/domain/types/control-flow.types'
import type { RaphDerivedManagerSnapshot, RaphDerivedOptions } from '@/domain/types/derived.types'
import type { RaphMetaMutationEvent, RaphMetaObserver, RaphObserveMetaOptions } from '@/domain/types/meta.types'
import type {
  PhaseEvent,
  PhaseExecutorContext,
  PhaseName,
  RaphPhase,
  ResolvedEntry,
  Traversal,
} from '@/domain/types/phase.types'
import type {
  RaphDataObserver,
  RaphObserveDataOptions,
  RaphRuntimeOptions,
} from '@/domain/types/runtime.types'
import { RAPH_DEBUG, RAPH_EVENTS, RAPH_MAX_UPS } from '@/domain/core/raph-shared'
import { RaphNode } from '@/domain/core/RaphNode'
import { RaphRouter } from '@/domain/core/RaphRouter'
import { ControlFlowQueue } from '@/domain/entities/ControlFlowQueue'
import { ControlFlowRegistry } from '@/domain/entities/ControlFlowRegistry'
import { DataPath } from '@/domain/entities/DataPath'
import { DepGraph } from '@/domain/entities/DepGraph'
import { MinHeap } from '@/domain/entities/MinHeap'
import { RaphPropagation } from '@/domain/local/local.types'
import { RaphMeta } from '@/domain/meta/RaphMeta'
import { SchedulerType } from '@/domain/types/base.types'
import { SegKind } from '@/domain/types/path.types'

/**
 * Управляет isolated Raph runtime lane: graph, scheduler, phases и dirty queue.
 */
export class RaphRuntime<Props extends RaphProperties = RaphProperties> {
  readonly id: string

  //
  // Константы
  //
  private _maxUps = RAPH_MAX_UPS
  private _minUpdateInterval = 1000 / RAPH_MAX_UPS
  private static readonly _PRIORITY_SCALE = 1 << 20 // ~1 млн: с запасом для weight
  private _priorityStrategy: RaphPriorityStrategy = 'depth-weight-desc'

  //
  // Подмодули
  //
  private readonly _kernel: RaphKernel
  private readonly _meta: RaphMeta
  private _nodeRouter: RaphRouter<RaphNode<any>> = new RaphRouter()
  private _phaseRouter: RaphRouter<PhaseName> = new RaphRouter()
  private _graph: DepGraph<RaphNode<any>> = new DepGraph()
  private _controlFlowRouter: RaphRouter<ControlFlowSubscriptionId> = new RaphRouter()
  private _controlFlowRegistry = new ControlFlowRegistry(this._controlFlowRouter)
  private _controlFlowQueue = new ControlFlowQueue()

  //
  // Планировщик для запуска фаз
  //
  private _scheduler: RaphScheduler = cb => cb()
  private _schedulerType: SchedulerType = SchedulerType.AnimationFrame
  private _schedulerPending = false

  //
  // Данные (Dirty логика)
  //
  private _dirty = new Map<PhaseName, PhaseDirty>()
  private _phaseBits = new Map<PhaseName, number>() // фаза -> бит

  //
  // Фазы
  //
  private _phasesArray: Array<RaphPhase> = []
  private _phasesMap: Map<PhaseName, RaphPhase> = new Map()

  //
  // Local / instant слой
  //
  private _ready = false
  private _destroyed = false
  private _root: RaphNode<Props>
  private _localProperties: Map<keyof Props & string, RaphLocalPropertyRuntime<Props, any>> = new Map()
  private _localPhases: Map<string, RaphLocalPhaseRuntime<Props>> = new Map()

  //
  // Debug
  //
  private __ups = 0
  private __lastUPSUpdate = performance.now()
  private __upsCount = 0
  private __isLoopActive = false
  private __manualLoopActive = false
  private __loopLeases = new Set<object>()
  private __lastTime = performance.now()
  private __frameStartedAt: number | null = null
  private __lastFrameNow: number | null = null
  private __frameNumber = 0
  private __frameContext: RaphFrameContext = {
    now: 0,
    delta: 0,
    elapsed: 0,
    frame: 0,
  }

  private __animationFrameId: number | null = null
  private __upsResetTimeout: number | null = null

  // Событий в секунду
  private __eps = 0
  private __lastEPSUpdate = performance.now()
  private __epsCount = 0
  private __epsResetTimeout: number | null = null

  // Изменённых узлов в секунду
  private __nps = 0
  private __npsCount = 0
  private __lastNPSUpdate = performance.now()
  private __npsResetTimeout: number | null = null

  // throttleTimer для run
  private __lastRunAt = 0
  private __throttleTimer: number | null = null

  //
  //
  /**
   * Создает instance и подготавливает внутреннее состояние.
   */
  constructor(options: RaphRuntimeOptions & { kernel: RaphKernel }) {
    this.id = options.id ?? 'runtime'
    this._kernel = options.kernel
    this._meta = new RaphMeta(this._kernel, this)
    this._root = new RaphNode<Props>(this, { id: '__root__', type: '__root__' })
    this._kernel.registerRuntime(this)
    if (options.scheduler !== undefined) {
      this.setScheduler(options.scheduler)
    }
  }

  /**
   * Применить настройки приложения.
   */
  options(opts: Partial<RaphOptions>): void {
    if (opts.maxUps !== undefined) {
      this._maxUps = opts.maxUps
    }
    if (opts.priority !== undefined) {
      this._priorityStrategy = opts.priority
    }
    if (opts.adapter !== undefined) {
      this._kernel.setDataAdapter(opts.adapter)
    }
    if (opts.scheduler !== undefined) {
      this.setScheduler(opts.scheduler)
    }
    if (opts.debug !== undefined) {
      RAPH_DEBUG.enable(opts.debug)
    }
    //
    this._minUpdateInterval = 1000 / this._maxUps
  }

  /** Создает системную materialized dependency в текущем runtime graph. */
  derive<TSource = unknown, TTarget = unknown>(
    options: RaphDerivedOptions<TSource, TTarget>,
  ): RaphDerivedHandle {
    return this._kernel.registerDerived(this, options)
  }

  /** Выполняет batch mutations через transaction shared kernel. */
  transaction(fn: () => void): void {
    this._kernel.transaction(fn)
  }

  /** Возвращает snapshot shared derived registry. */
  getDerivedSnapshot(): RaphDerivedManagerSnapshot {
    return this._kernel.getDerivedSnapshot()
  }

  /**
   * Заменить набор пользовательских фаз приложения.
   */
  definePhases(phases: Array<RaphPhase>): void {
    this._phasesArray = phases
    this.reinitPhases()
  }

  /**
   * Добавить одну фазу в конец pipeline.
   */
  addPhase(phase: RaphPhase): void {
    this._phasesArray.push(phase)
  }

  /**
   * Очистить все фазы приложения.
   */
  clearPhases(): void {
    this._phasesArray = []
    this._phasesMap.clear()
    this.reinitPhases()
  }

  /**
   * Инициализация фаз.
   * Подразумевается, что фазы уже добавлены в this._phasesArray
   */
  reinitPhases(): void {
    this._phasesMap.clear()

    this._phaseBits.clear()
    this._phasesArray.forEach((p, i) => this._phaseBits.set(p.name, 1 << i))

    // Пересобираем фазовый роутер с нуля: маска -> имя фазы
    this._phaseRouter = new RaphRouter<PhaseName>()
    for (const phase of this._phasesArray) {
      this._phasesMap.set(phase.name, phase)
      for (const mask of phase.routes ?? []) {
        // если список маршрутов пуст - фаза никогда не триггерится по данным
        this._phaseRouter.add(mask, phase.name)
      }
    }

    RAPH_EVENTS.emit('phases:reinit', {
      phases: this._phasesArray,
    })
  }

  /**
   * Получить ноду по идентификатору.
   */
  getNode(id: string): RaphNode<Props> | undefined {
    return this._graph.getNode(id) as RaphNode<Props> | undefined
  }

  /**
   * Зарегистрировать ноду в графе приложения.
   */
  addNode(node: RaphNode<Props>): void {
    if (this._ready && node !== this._root && !node.parent) {
      this._root.addChild(node)
      return
    }

    this.registerNode(node)
  }

  /**
   * Регистрирует node.
   */
  registerNode(node: RaphNode<any>): void {
    node._attachApp(this)
    this._graph.addNode(node)
    RAPH_EVENTS.emit('nodes:changed', { graph: this._graph })
  }

  /**
   * Удалить зарегистрированный узел из RaphApp.
   */
  removeNode(node: RaphNode<any>): void {
    this.unsubscribeOwner(node)
    this._kernel.removeDataObserversByNode(this, node)
    this._kernel.removeMetaObserversByNode(this, node)
    if (node.parent) {
      const siblings = node.parent.children
      const index = siblings.indexOf(node)
      if (index >= 0) {
        siblings.splice(index, 1)
      }
    }
    this._graph.removeNode(node.id)
    RAPH_EVENTS.emit('nodes:changed', { graph: this._graph })
  }

  /**
   * Снимает регистрацию node.
   */
  unregisterNode(node: RaphNode<any>): void {
    this.unsubscribeOwner(node)
    this._kernel.removeDataObserversByNode(this, node)
    this._kernel.removeMetaObserversByNode(this, node)
    this._graph.removeNode(node.id)
    RAPH_EVENTS.emit('nodes:changed', { graph: this._graph })
  }

  /**
   * Добавить зависимость parent -> child.
   */
  addDependency(parent: RaphNode<any>, child: RaphNode<any>): boolean {
    const res = this._graph.addEdge(parent.id, child.id)
    RAPH_EVENTS.emit('nodes:changed', { graph: this._graph })
    return res
  }

  /**
   * Удалить зависимость parent -> child.
   */
  removeDependency(parent: RaphNode<any>, child: RaphNode<any>): void {
    this._graph.removeEdge(parent.id, child.id)
    RAPH_EVENTS.emit('nodes:changed', { graph: this._graph })
  }

  /**
   * Выполняет внутреннюю операцию init.
   */
  init(): void {
    if (this._ready) {
      console.warn('[RaphApp] Already initialized, skipping.')
      return
    }

    this.registerNode(this._root)
    for (const phase of this._localPhases.values()) {
      phase.finalize()
    }
    this.reinitPhases()
    this.dirtyLocalNodeDefaults(this._root)
    this._ready = true
  }

  /**
   * Очищает внутреннее состояние.
   */
  clear(): void {
    this.reset()
    this._kernel.unregisterRuntime(this)
    this._destroyed = true
  }

  /**
   * Уничтожает runtime lane.
   */
  destroy(): void {
    this.clear()
  }

  /**
   * Выполняет внутреннюю операцию traverse all.
   */
  traverseAll(cb: (node: RaphNode<Props>) => void): void {
    this._root.traverseAll(cb)
  }

  /**
   * Добавляет local phase.
   */
  addLocalPhase(phase: RaphLocalPhaseRuntime<Props>): void {
    this._localPhases.set(phase.name, phase)
    this.addPhase(this._toRuntimeLocalPhase(phase))
  }

  /**
   * Добавляет local property.
   */
  addLocalProperty<K extends keyof Props>(property: RaphLocalPropertyRuntime<Props, K>): void {
    this._localProperties.set(property.name as keyof Props & string, property)

    const phase = this._localPhases.get(property.phase)
    if (!phase) {
      throw new Error(`[RaphApp] Phase "${property.phase}" not found for property "${String(property.name)}"`)
    }

    phase.addProperty(property)
    this._syncLocalPhaseTraversal(phase)
  }

  /**
   * Возвращает local property.
   */
  getLocalProperty<K extends keyof Props>(key: K): RaphLocalPropertyRuntime<Props, K> | undefined {
    return this._localProperties.get(key as keyof Props & string) as RaphLocalPropertyRuntime<Props, K> | undefined
  }

  /**
   * Выполняет внутреннюю операцию dirty local node defaults.
   */
  dirtyLocalNodeDefaults(node: RaphNode<any>, invalidate = false): void {
    for (const property of this._localProperties.values()) {
      this.dirty(property.phase as PhaseName, node, { invalidate })
    }
  }

  /**
   * Настроить планировщик запуска фаз.
   */
  setScheduler(mode: SchedulerType): void {
    if (mode === SchedulerType.Microtask) {
      this._scheduler = cb => queueMicrotask(cb)
    }
    else if (mode === SchedulerType.AnimationFrame) {
      this._scheduler = cb => requestAnimationFrame(cb)
    }
    else {
      this._scheduler = cb => cb()
    }
    this._schedulerType = mode
  }
  // внутри класса RaphApp

  /**
   * Выполняет внутреннюю операцию build resolved.
   */
  private _buildResolved(
    path: DataPathDef,
    vars?: Record<string, any>,
  ): {
    resolved: Array<ResolvedEntry>
    canonical: string
    canonicalDataPath: DataPath
  } {
    // 1) нормализованный путь (со звёздочками) для каноники/логов
    const norm = DataPath.from(path, { vars, wildcardDynamic: true })

    // 2) пройдёмся по исходным сегментам (без wildcardDynamic), чтобы увидеть реальные Param
    const segs = DataPath.from(path, { vars }).segments()

    // накапливаем "имя текущего контейнера" (последний ключевой сегмент)
    let lastContainerKey = ''
    // строим префикс пути до текущего места (для indexOf)
    let prefixStr = ''

    const pushDot = (k: string) => {
      prefixStr = prefixStr ? `${prefixStr}.${k}` : k
    }

    const resolved: Array<ResolvedEntry> = []

    for (const s of segs) {
      switch (s.kind) {
        case SegKind.Key: {
          const key = String(s.key!)
          lastContainerKey = key
          pushDot(key)
          break
        }
        case SegKind.Index: {
          prefixStr += `[${s.index}]`
          break
        }
        case SegKind.Param: {
          // вычислим реальное значение pval, если это путь/переменная
          let evalVal: unknown = s.pval
          if (typeof s.pval === 'string' && s.pval.startsWith('$')) {
            try {
              evalVal = this._kernel.dataAdapter.get(s.pval, { vars })
            }
            catch {
              // оставим как есть, индекс вероятно будет -1
            }
          }

          // построим путь до массива + [pk=evalVal] и спросим indexOf
          // пример: "FLT_ARR.attrs[legId=...]" - получим индекс этого элемента
          const idxPath
            = typeof evalVal === 'number' || typeof evalVal === 'boolean'
              ? `${prefixStr}[${s.pkey}=${String(evalVal)}]`
              : `${prefixStr}[${s.pkey}=${JSON.stringify(String(evalVal))}]`

          let index = -1
          try {
            index = this._kernel.dataAdapter.indexOf(idxPath, { vars })
          }
          catch {
            index = -1
          }

          resolved.push({
            segment: lastContainerKey || '', // например "attrs" / "legs"
            keyField: s.pkey!,
            keyValue: s.pval, // оставляем исходное (может быть "$store.legs[$i].id]")
            index,
          })

          // продолжим префикс, двигаясь внутрь найденного элемента массива
          if (index >= 0) {
            prefixStr += `[${index}]`
          }
          else {
            // если не нашли - формально двигаемся как [*], чтобы структура префикса не ломалась
            // это никак не влияет на canonical (он уже посчитан выше), нужно только для
            // последовательности шага
            prefixStr += '[*]'
          }
          break
        }
        case SegKind.Wildcard: {
          // в исходном пути редко, но поддержим как один сегмент
          // для префикса сериализуем как '.*' (не влияет на canonical/резолв)
          // префикс нам нужен только для indexOf в Param, сюда не доходим по сути
          prefixStr += prefixStr && !prefixStr.endsWith('.') ? '.*' : '*'
          break
        }
      }
    }

    return { resolved, canonical: norm.toStringPath(), canonicalDataPath: norm }
  }

  /**
   * Выполняет внутреннюю операцию create phase event.
   */
  private _createPhaseEvent(
    path: DataPathDef,
    vars?: Record<string, any>,
  ): PhaseEvent {
    const { canonical, canonicalDataPath, resolved } = this._buildResolved(
      path,
      vars,
    )

    return {
      original: path as string,
      canonical,
      canonicalDataPath,
      resolved,
    }
  }

  /**
   * Уведомление об изменении данных.
   * Вызывается при изменении данных в RaphApp.
   */
  notify(
    path: DataPathDef,
    opts?: { invalidate?: boolean, vars?: Record<string, any> },
  ): boolean {
    const { invalidate = true } = opts ?? {}

    const event = this._createPhaseEvent(path, opts?.vars)
    const { canonical } = event

    /**
     * Control flow работает даже если пользовательские фазы не определены.
     * Поэтому ранний выход возможен только когда не нашлось ни фаз, ни подписок.
     */
    const phaseHits
      = this._phasesArray.length > 0
        ? this._phaseRouter.match(canonical)
        : new Set<PhaseName>()
    const controlHits = this._controlFlowRegistry.match(canonical)

    if (phaseHits.size === 0 && controlHits.length === 0) {
      return false
    }

    // EPS считаем за notify (если нужно - оставьте ваш текущий блок EPS тут)
    {
      this.__epsCount++
      const now = performance.now()
      if (now - this.__lastEPSUpdate >= 1000) {
        this.__eps = this.__epsCount
        this.__epsCount = 0
        this.__lastEPSUpdate = now
      }
      if (this.__epsResetTimeout !== null) {
        clearTimeout(this.__epsResetTimeout)
      }
      this.__epsResetTimeout = setTimeout(() => {
        this.__eps = 0
        this.__epsResetTimeout = null
      }, 1500) as any as number
    }

    // 2) Базовый набор нод по событию - один раз для всех фаз
    // const baseNodes = this._nodeRouter.matchIncludingPrefix(evtPath)

    const matches = phaseHits.size > 0 ? this._nodeRouter.match(canonical) : new Set<RaphNode<any>>()

    // const matchesWithParams =
    //   this._nodeRouter.matchIncludingPrefixWithParams?.(canonical) ?? []
    //
    // const nodeParams = new Map<string, Record<string, unknown>>()
    //
    // let baseNodes = new Set<RaphNode>()
    // if (matchesWithParams.length) {
    //   for (const m of matchesWithParams) {
    //     baseNodes.add(m.payload)
    //     nodeParams.set(m.payload.id, m.params ?? {})
    //   }
    // } else {
    //   // фоллбек на старый Set без params
    //   baseNodes = this._nodeRouter.match(canonical) as Set<RaphNode>
    // }

    // 3) Мемоизация расширений по типу traversal, чтобы не пересчитывать
    const expandedCache = new Map<
      'dirty-only' | 'dirty-and-down' | 'dirty-and-up' | 'all',
      Set<RaphNode<any>>
    >()

    const getExpanded = (
      traversal: 'dirty-only' | 'dirty-and-down' | 'dirty-and-up' | 'all',
    ): Set<RaphNode<any>> => {
      let s = expandedCache.get(traversal)
      if (s) {
        return s
      }

      if (traversal === 'all') {
        s = this._graph.expandByTraversal(null, 'all')
      }
      else {
        s
          = matches.size > 0
            ? this._graph.expandByTraversal(matches, traversal)
            : new Set()
      }
      expandedCache.set(traversal, s)
      return s
    }

    let affectedNodesTotal = 0

    // 4) Для каждой фазы раскладываем соответствующие ноды в бакеты
    for (const phaseName of phaseHits) {
      const phase = this._phasesMap.get(phaseName)
      if (!phase) {
        continue
      }

      if (phase.traversal !== 'all' && matches.size === 0) {
        // нет базовых нод - фаза со специальным обходом не сработает
        continue
      }

      const expanded = getExpanded(phase.traversal)
      // console.log('Phase:', phase.name)
      // console.log('Traversal:', phase.traversal)
      // console.log('Nodes:', expanded)

      affectedNodesTotal += expanded.size

      if (expanded.size === 0) {
        continue
      }

      const queuedNodes
        = phase.traversal === 'all' || phase.traversal === 'dirty-and-down'
          ? expanded
          : matches

      for (const node of queuedNodes) {
        this.dirty(phase.name, node, {
          invalidate: false,
          event,
        })
      }
    }

    let hasDirtyControlFlow = false
    for (const hit of controlHits) {
      hasDirtyControlFlow
        = this._controlFlowQueue.enqueue(hit.record, event, hit.params)
          || hasDirtyControlFlow
    }

    if (affectedNodesTotal > 0) {
      const now = performance.now()
      this.__npsCount += affectedNodesTotal
      if (now - this.__lastNPSUpdate >= 1000) {
        this.__nps = this.__npsCount
        this.__npsCount = 0
        this.__lastNPSUpdate = now
      }
      if (this.__npsResetTimeout !== null) {
        clearTimeout(this.__npsResetTimeout)
      }
      this.__npsResetTimeout = setTimeout(() => {
        this.__nps = 0
        this.__npsResetTimeout = null
      }, 1500) as any as number
    }

    if ((affectedNodesTotal > 0 || hasDirtyControlFlow) && invalidate) {
      this.invalidate()
    }

    // console.log('-------------')
    return affectedNodesTotal > 0 || hasDirtyControlFlow
  }

  /**
   * Подписывает node на business data path с прямым указанием target phase.
   */
  observeData(
    node: RaphNode<any>,
    mask: DataPathDef,
    options: RaphObserveDataOptions,
  ): () => void {
    return this._kernel.registerDataObserver(this, node, mask, options)
  }

  /** Подписывает runtime-ноду на отдельный Meta-plane. */
  observeMeta(
    node: RaphNode<any>,
    mask: DataPathDef,
    options: RaphObserveMetaOptions,
  ): () => void {
    return this._kernel.registerMetaObserver(this, node, mask, options)
  }

  /**
   * Ставит direct data observer в dirty queue.
   */
  enqueueDataObserver(
    observer: RaphDataObserver<any>,
    path: DataPathDef,
    opts?: { invalidate?: boolean, vars?: Record<string, any> },
  ): boolean {
    if (observer.runtime !== this) {
      return false
    }

    const phaseName = observer.phase as PhaseName
    if (!this._phasesMap.has(phaseName)) {
      return false
    }

    const event = this._createPhaseEvent(path, opts?.vars)
    const nodes = this._resolveObserverNodes(observer.node, observer.traversal ?? 'dirty-only')

    if (nodes.length === 0) {
      return false
    }

    for (const node of nodes) {
      this.dirty(phaseName, node, {
        invalidate: false,
        event: node === observer.node ? event : undefined,
      })
    }

    return true
  }

  /** Ставит Meta observer в ту же phase queue, не создавая data notification. */
  enqueueMetaObserver(observer: RaphMetaObserver<any>, mutation: RaphMetaMutationEvent): boolean {
    if (observer.runtime !== this) {
      return false
    }
    const phaseName = observer.phase as PhaseName
    if (!this._phasesMap.has(phaseName)) {
      return false
    }
    const event = this._createPhaseEvent(mutation.path)
    const nodes = this._resolveObserverNodes(observer.node, observer.traversal ?? 'dirty-only')
    if (nodes.length === 0) {
      return false
    }
    for (const node of nodes) {
      this.dirty(phaseName, node, {
        invalidate: false,
        event: node === observer.node ? event : undefined,
      })
    }
    return true
  }

  /**
   * Пометить узел dirty в фазе
   */
  dirty(
    phase: PhaseName | string,
    node: RaphNode<any>,
    opts?: { invalidate: boolean, event?: PhaseEvent },
  ): void {
    const phaseName = phase as PhaseName
    const phaseInstance = this._phasesMap.get(phaseName)
    if (!phaseInstance) {
      console.warn(`[RaphApp] Phase "${phase}" not found`)
      return
    }

    // Фильтр по узлам (массив типов)
    if (
      phaseInstance.nodes
      && Array.isArray(phaseInstance.nodes)
      && !phaseInstance.nodes.includes(node.type as any)
    ) {
      return
    }

    // Фильтр по узлам (лямбда-функция)
    if (
      phaseInstance.nodes
      && typeof phaseInstance.nodes === 'function'
      && !phaseInstance.nodes(node)
    ) {
      return
    }

    const { invalidate = true, event } = opts ?? {}

    const idx = this._priority(node)
    const q = this._getPhaseDirty(phaseName)

    const bit = this._phaseBits.get(phaseName) ?? 0
    if (bit && node.hasDirtyPhase(bit)) {
      if (event) {
        const list = q.events.get(node.id)
        if (list) {
          list.push(event)
        }
        else {
          q.events.set(node.id, [event])
        }
      }
      return
    }

    let arr = q.buckets.get(idx)
    if (!arr) {
      arr = []
      q.buckets.set(idx, arr)
    }
    arr.push(node)

    //
    if (!q.inHeap.has(idx)) {
      q.inHeap.add(idx)
      q.heap.push(idx)
    }

    if (event) {
      const list = q.events.get(node.id)
      if (list) {
        list.push(event)
      }
      else { q.events.set(node.id, [event]) }
    }

    if (bit) {
      node.markDirtyPhase(bit)
    }
    if (invalidate) {
      this.invalidate()
    }
  }

  /**
   * Выполняет внутреннюю операцию schedule run throttled.
   */
  private _scheduleRunThrottled(): void {
    if (this._destroyed) {
      return
    }

    if (!this.loopEnabled) {
      this.run()
      return
    }

    // уже ждём слота - коалесцируем
    if (this.__throttleTimer !== null || this._schedulerPending) {
      return
    }

    const now = performance.now()
    const elapsed = now - this.__lastRunAt
    const delay = Math.max(0, this._minUpdateInterval - elapsed)

    if (delay === 0) {
      this.run()
    }
    else {
      // ставим один таймер до ближайшего слота (коалесцируем все invalidate)
      this.__throttleTimer = setTimeout(() => {
        this.__throttleTimer = null
        // защитимся от гонок: если кто-то успел поставить _schedulerPending - коалесцируем
        if (this._schedulerPending) {
          return
        }
        this._schedulerPending = true
        this._scheduler(() => {
          this._schedulerPending = false
          this.run()
        })
      }, delay) as any as number
    }
  }

  /**
   * Итерация реактивного графа.
   * Обновляет грязные узлы в контексте фаз.
   * Если грязных узлов нет - ничего не делает.
   */
  run(): void {
    if (this._destroyed) {
      console.warn('[RaphApp] destroyed, skipping run. Call reset() to release all resources and start over.')
      return
    }

    this.__lastRunAt = performance.now()

    const now = this.__lastRunAt
    const delta = this.__lastFrameNow === null ? 0 : Math.min(100, Math.max(0, now - this.__lastFrameNow))
    this.__lastFrameNow = now
    if (this.__frameStartedAt === null) {
      this.__frameStartedAt = now
    }
    this.__frameContext = {
      now,
      delta,
      elapsed: now - this.__frameStartedAt,
      frame: this.__frameNumber++,
    }
    const frame = this.__frameContext

    this.__upsCount++
    if (now - this.__lastUPSUpdate >= 1000) {
      this.__ups = this.__upsCount
      this.__upsCount = 0
      this.__lastUPSUpdate = now
    }

    if (!this.loopEnabled) {
      if (this.__upsResetTimeout !== null) {
        clearTimeout(this.__upsResetTimeout)
      }
      this.__upsResetTimeout = setTimeout(() => {
        this.__ups = 0
        this.__upsResetTimeout = null
      }, 1500) as any as number
    }

    for (const phase of this._phasesArray) {
      const q = this._dirty.get(phase.name)!
      const hasDirty = Boolean(q && q.inHeap.size > 0)
      if (!hasDirty && !phase.always) {
        continue
      }

      const bit = this._phaseBits.get(phase.name) ?? 0

      if ('all' in phase && typeof phase.all === 'function') {
        // Собираем все dirty-ноды по всем bucket
        const ctxs: Array<PhaseExecutorContext> = []

        if (phase.mode === 'all' && hasDirty) {
          for (const node of this._orderedAllNodes()) {
            if (bit) {
              node.clearDirtyPhase(bit)
            }
            const events = q.events?.get(node.id) ?? undefined
            ctxs.push({ phase: phase.name, node, frame, events })
          }
          q.buckets.clear()
          q.events.clear()
          q.inHeap.clear()
          q.heap.clear()
        }
        else if (hasDirty) {
          for (const bucketIdx of q.inHeap) {
            const arr = q.buckets.get(bucketIdx)
            if (!arr || arr.length === 0) {
              continue
            }

            for (let i = 0; i < arr.length; i++) {
              const node = arr[i]
              if (bit) {
                node.clearDirtyPhase(bit)
              }
              const events = q.events?.get(node.id) ?? undefined
              ctxs.push({ phase: phase.name, node, frame, events })
            }

            q.buckets.delete(bucketIdx)
          }

          q.events.clear()
          q.inHeap.clear()
          q.heap.clear()
        }
        else if (phase.always) {
          ctxs.push({ phase: phase.name, node: this._root, frame })
        }

        const expandedCtxs = this._expandRuntimeContexts(phase, ctxs)

        // Единый вызов all()
        phase.all(expandedCtxs)
        RAPH_EVENTS.emit('nodes:notified', { ctxs: expandedCtxs })
      }
      else if ('each' in phase && typeof phase.each === 'function') {
        // По бакетам
        if (!hasDirty && phase.always) {
          phase.each({ phase: phase.name, node: this._root, frame })
          RAPH_EVENTS.emit('node:notified', { node: this._root, event: null })
          continue
        }

        const ctxs: Array<PhaseExecutorContext> = []

        while (!q.heap.empty) {
          const bucketIdx = q.heap.pop()!
          q.inHeap.delete(bucketIdx)

          const arr = q.buckets.get(bucketIdx)
          if (!arr || arr.length === 0) {
            continue
          }

          for (let i = 0; i < arr.length; i++) {
            const node = arr[i]
            if (bit) {
              node.clearDirtyPhase(bit)
            }
            const events = q.events?.get(node.id) ?? undefined
            ctxs.push({ phase: phase.name, node, frame, events })
          }

          q.buckets.delete(bucketIdx)
        }

        const expandedCtxs = this._expandRuntimeContexts(phase, ctxs)
        for (const ctx of expandedCtxs) {
          phase.each(ctx)
          RAPH_EVENTS.emit('node:notified', { node: ctx.node, event: ctx.events ?? null })
        }

        q.events.clear()
      }
    }

    this._controlFlowQueue.flush(subscriptionId =>
      this._controlFlowRegistry.get(subscriptionId),
    )
  }

  /**
   * Получить значение по пути из data adapter.
   */
  get(
    path: DataPathDef,
    opts?: {
      vars?: Record<string, any>
    },
  ): Undefinable<unknown> {
    return this._kernel.get(path, opts)
  }

  /** Проверяет существование data path, включая значение undefined. */
  has(path: DataPathDef, opts?: { vars?: Record<string, any> }): boolean {
    return this._kernel.has(path, opts)
  }

  /**
   * Установить значение по пути и отправить notify.
   */
  set(
    path: DataPathDef,
    value: unknown,
    opts?: { invalidate?: boolean, vars?: Record<string, any> },
  ): void {
    this._kernel.set(path, value, opts)
  }

  /**
   * Слить значение по пути и отправить notify.
   */
  merge(
    path: DataPathDef,
    value: unknown,
    opts?: { invalidate?: boolean, vars?: Record<string, any> },
  ): void {
    this._kernel.merge(path, value, opts)
  }

  /**
   * Удалить значение по пути и отправить notify.
   */
  delete(
    path: DataPathDef,
    opts?: { invalidate?: boolean, vars?: Record<string, any> },
  ): void {
    this._kernel.delete(path, opts)
  }

  /**
   * Запускает цикл обновления по
   * заданному планировщику
   */
  startLoop(): void {
    this.__manualLoopActive = true
    this._ensureLoop()
  }

  /**
   * Выполняет внутреннюю операцию acquire loop.
   */
  acquireLoop(owner: string): RaphLoopLease {
    const token = {}
    let released = false
    this.__loopLeases.add(token)
    this._ensureLoop()

    return {
      owner,
      release: () => {
        if (released) {
          return
        }
        released = true
        this.__loopLeases.delete(token)
        this._stopLoopIfIdle()
      },
    }
  }

  /**
   * Выполняет внутреннюю операцию ensure loop.
   */
  private _ensureLoop(): void {
    if (this.__isLoopActive) {
      return
    }
    this.__isLoopActive = true

    const loop = (_time: number): void => {
      if (!this.__isLoopActive) {
        return
      }

      this.invalidate()

      if (this._schedulerType === SchedulerType.AnimationFrame) {
        this.__animationFrameId = requestAnimationFrame(loop)
      }
      else {
        queueMicrotask(() => loop(performance.now()))
      }
    }

    loop(this.__lastTime)
  }

  /**
   * Остановить цикл обновления.
   */
  stopLoop(): void {
    this.__manualLoopActive = false
    this._stopLoopIfIdle()
  }

  /**
   * Выполняет внутреннюю операцию stop loop if idle.
   */
  private _stopLoopIfIdle(): void {
    if (this.__manualLoopActive || this.__loopLeases.size > 0) {
      return
    }

    this.__isLoopActive = false

    //
    this.__ups = 0
    if (this.__animationFrameId !== null) {
      cancelAnimationFrame(this.__animationFrameId)
      this.__animationFrameId = null
    }
    if (this.__upsResetTimeout !== null) {
      clearTimeout(this.__upsResetTimeout)
      this.__upsResetTimeout = null
    }

    //
    this.__eps = 0
    if (this.__epsResetTimeout !== null) {
      clearTimeout(this.__epsResetTimeout)
      this.__epsResetTimeout = null
    }

    //
    this.__nps = 0
    if (this.__npsResetTimeout !== null) {
      clearTimeout(this.__npsResetTimeout)
      this.__npsResetTimeout = null
    }

    //
    if (this.__throttleTimer !== null) {
      clearTimeout(this.__throttleTimer)
      this.__throttleTimer = null
    }
  }

  /**
   * Функция, которая помечает core, требующим обновления.
   * Однако обновления произойдет только, если есть грязные узлы.
   */
  invalidate(): void {
    if (this._schedulerPending) {
      return
    }

    this._schedulerPending = true
    this._scheduler(() => {
      this._schedulerPending = false
      if (this._destroyed) {
        return
      }
      this._scheduleRunThrottled()
    })
  }

  /**
   * Полная очистка RaphApp состояния
   */
  reset(): void {
    this.__manualLoopActive = false
    this.__loopLeases.clear()
    this._stopLoopIfIdle()
    this.__lastFrameNow = null
    this.__frameStartedAt = null
    this.__frameNumber = 0
    this.__frameContext = {
      now: 0,
      delta: 0,
      elapsed: 0,
      frame: 0,
    }

    for (const child of [...this._root.children]) {
      child.dispose()
    }
    this._root.children.length = 0

    this._nodeRouter.removeAll()
    this._kernel.disposeRuntimeDerived(this)
    this._kernel.removeDataObserversByRuntime(this)
    this._kernel.removeMetaObserversByRuntime(this)
    this._controlFlowRegistry.clear()
    this._controlFlowQueue.clear()
    this._dirty.clear()
    this._graph = new DepGraph<RaphNode<any>>()
    this._ready = false
    this._destroyed = false
  }

  /** Возвращает runtime-bound фасад пользовательской metadata. */
  get meta(): RaphMeta {
    return this._meta
  }

  /**
   * Зарегистрировать подписку control flow.
   * Callback будет вызван после стабилизации evaluation-пайплайна.
   */
  subscribe(
    ownerNode: RaphNode<any>,
    maskOrMasks: DataPathDef | Array<DataPathDef>,
    callback: ControlFlowCallback,
    opts?: ControlFlowSubscribeOptions,
  ): () => void {
    const record = this._controlFlowRegistry.subscribe(
      ownerNode,
      maskOrMasks,
      callback,
      opts,
    )

    return () => this.unsubscribe(record.id)
  }

  /**
   * Снять одну подписку control flow.
   */
  unsubscribe(subscriptionId: ControlFlowSubscriptionId): void {
    this._controlFlowQueue.delete(subscriptionId)
    this._controlFlowRegistry.unsubscribe(subscriptionId)
  }

  /**
   * Снять все подписки конкретной owner-ноды.
   */
  unsubscribeOwner(ownerNode: RaphNode<any>): void {
    const ownerId = ownerNode.id
    const subscriptionIds
      = this._controlFlowRegistry.getSubscriptionIdsByOwner(ownerId)

    /**
     * Важно чистить и queue, и registry.
     * Registry снимет маршруты, а queue не даст выполнить уже накопленные callbacks.
     */
    for (const subscriptionId of subscriptionIds) {
      this._controlFlowQueue.delete(subscriptionId)
    }

    this._controlFlowRegistry.unsubscribeOwner(ownerId)
  }

  //
  // PRIVATE
  //

  /**
   * Зарегистрировать зависимость ноды от пути/маски.
   * dep может быть: строка ("rows[0].x"), DataPath или plain-JSON.
   * Возвращает стабильный ключ (бренд-строку), по которому хранится подписка.
   */
  track(
    node: RaphNode<any>,
    mask: DataPathDef,
    opts?: {
      vars?: Record<string, any>
      wildcardDynamic?: boolean
    },
  ): void {
    const dp = DataPath.from(mask, opts)

    // console.log('[RAPH TRACK]')
    // console.log('Path:', dp.toStringPath())
    // console.log('Node:', node)
    this._nodeRouter.add(dp, node)
    RAPH_EVENTS.emit('node:tracked', { node, path: dp.toStringPath() })
  }

  /**
   * Снять зависимость ноды. Если dep не передан - снимаем все зависимости ноды.
   */
  untrack(node: RaphNode<any>, mask?: DataPathDef): void {
    if (!mask) {
      // Снимаем все зависимости
      this._nodeRouter.removePayload(node)
      RAPH_EVENTS.emit('node:untracked', { node })
      return
    }

    const path = DataPath.from(mask).toStringPath()
    this._nodeRouter.remove(path, node)
    RAPH_EVENTS.emit('node:untracked', { node, path })
  }

  /** Snapshot только для чтения, используемый проекциями live-отладки. */
  getTrackedMasks(node: RaphNode<any>): ReadonlySet<string> {
    return this._nodeRouter.masksFor(node)
  }

  //
  // PRIVATE
  //

  /**
   * Выполняет внутреннюю операцию get phase dirty.
   */
  private _getPhaseDirty(phase: PhaseName): PhaseDirty {
    let q = this._dirty.get(phase)
    if (!q) {
      q = {
        buckets: new Map(),
        heap: new MinHeap(),
        inHeap: new Set(),
        events: new Map(),
      }
      this._dirty.set(phase, q)
    }
    return q
  }

  /**
   * Выполняет внутреннюю операцию resolve observer nodes.
   */
  private _resolveObserverNodes(node: RaphNode<any>, traversal: Traversal): Array<RaphNode<any>> {
    if (!this._graph.hasNode(node)) {
      return []
    }

    if (traversal === 'dirty-only') {
      return [node]
    }

    if (traversal === 'dirty-and-down') {
      const result: Array<RaphNode<any>> = []
      node.traverseAll((child) => {
        if (this._graph.hasNode(child)) {
          result.push(child)
        }
      })
      return result
    }

    if (traversal === 'dirty-and-up') {
      const result: Array<RaphNode<any>> = []
      let current: RaphNode<any> | null = node
      while (current) {
        if (this._graph.hasNode(current)) {
          result.push(current)
        }
        current = current.parent
      }
      return result
    }

    return this._orderedAllNodes()
  }

  /**
   * Выполняет внутреннюю операцию priority of.
   */
  priorityOf(node: RaphNode<any>): number {
    return this._priority(node)
  }

  /**
   * Выполняет внутреннюю операцию priority.
   */
  private _priority(node: RaphNode<any>): number {
    // depth растёт - индекс растёт - обрабатываем раньше те, у кого depth меньше.
    // default: внутри одного depth больший weight должен пойти раньше.
    // legacy local: внутри одного depth меньший weight должен пойти раньше.
    const depth = this._graph.getDepth(node)
    if (this._priorityStrategy === 'legacy-depth-weight-asc') {
      return depth * RaphRuntime._PRIORITY_SCALE + node.weight
    }
    return depth * RaphRuntime._PRIORITY_SCALE - node.weight
  }

  /**
   * Выполняет внутреннюю операцию ordered all nodes.
   */
  private _orderedAllNodes(): Array<RaphNode<any>> {
    return this._graph.topoOrder()
  }

  /**
   * Выполняет внутреннюю операцию expand runtime contexts.
   */
  private _expandRuntimeContexts(
    phase: RaphPhase,
    ctxs: Array<PhaseExecutorContext>,
  ): Array<PhaseExecutorContext> {
    if (phase.mode === 'all' || phase.traversal === 'all') {
      const frame = ctxs[0]?.frame ?? this.__frameContext
      return this._orderedAllNodes().map(node => ({ phase: phase.name, node, frame }))
    }

    if (phase.traversal === 'dirty-and-down') {
      const seen = new Set<string>()
      const result: Array<PhaseExecutorContext> = []

      for (const ctx of ctxs) {
        ctx.node.traverseAll((node) => {
          if (seen.has(node.id) || !this._graph.hasNode(node)) {
            return
          }
          seen.add(node.id)
          result.push({
            phase: phase.name,
            node,
            frame: ctx.frame,
            events: node === ctx.node ? ctx.events : undefined,
          })
        })
      }

      return result
    }

    if (phase.traversal === 'dirty-and-up') {
      const seen = new Set<string>()
      const result: Array<PhaseExecutorContext> = []

      for (const ctx of ctxs) {
        let node: RaphNode<any> | null = ctx.node
        while (node) {
          if (!seen.has(node.id) && this._graph.hasNode(node)) {
            seen.add(node.id)
            result.push({
              phase: phase.name,
              node,
              frame: ctx.frame,
              events: node === ctx.node ? ctx.events : undefined,
            })
          }
          node = node.parent
        }
      }

      return result
    }

    return ctxs
  }

  /**
   * Выполняет внутреннюю операцию to runtime local phase.
   */
  private _toRuntimeLocalPhase(localPhase: RaphLocalPhaseRuntime<Props>): RaphPhase {
    const runtimePhase: RaphPhase = {
      name: localPhase.name as PhaseName,
      traversal: this._localTraversal(localPhase),
      routes: [],
      mode: localPhase.mode,
      always: localPhase.always,
      all: (ctxs) => {
        const events = new Map<RaphNode<Props>, NonNullable<PhaseExecutorContext['events']>>()
        for (const ctx of ctxs) {
          if (ctx.events?.length) {
            events.set(ctx.node as RaphNode<Props>, ctx.events)
          }
        }
        localPhase.run({
          frame: ctxs[0]?.frame ?? this.__frameContext,
          root: this._root,
          dirty: ctxs.map(ctx => ctx.node as RaphNode<Props>),
          events: events.size > 0 ? events : undefined,
        })
      },
    }

    return runtimePhase
  }

  /**
   * Выполняет внутреннюю операцию sync local phase traversal.
   */
  private _syncLocalPhaseTraversal(localPhase: RaphLocalPhaseRuntime<Props>): void {
    const runtimePhase = this._phasesMap.get(localPhase.name as PhaseName)
      ?? this._phasesArray.find(phase => phase.name === localPhase.name)
    if (runtimePhase) {
      runtimePhase.traversal = this._localTraversal(localPhase)
      runtimePhase.mode = localPhase.mode
      runtimePhase.always = localPhase.always
    }
  }

  /**
   * Выполняет внутреннюю операцию local traversal.
   */
  private _localTraversal(localPhase: RaphLocalPhaseRuntime<Props>): RaphPhase['traversal'] {
    if (localPhase.mode === 'all') {
      return 'all'
    }
    if (localPhase.properties.some(prop => prop.propagation === RaphPropagation.Down)) {
      return 'dirty-and-down'
    }
    if (localPhase.properties.some(prop => prop.propagation === RaphPropagation.Up)) {
      return 'dirty-and-up'
    }
    return 'dirty-only'
  }

  //
  // МЕТОДЫ ЧТЕНИЯ И ИЗМЕНЕНИЯ
  //

  /**
   * Вернуть корневые данные приложения.
   */
  get data(): DataObject {
    return this._kernel.data
  }

  /**
   * Вернуть граф зависимостей приложения.
   */
  get graph(): DepGraph<RaphNode<any>> {
    return this._graph
  }

  /**
   * Проверить, запущен ли цикл обновления.
   */
  get loopEnabled(): boolean {
    return this.__isLoopActive
  }

  /**
   * Возвращает frame.
   */
  get frame(): RaphFrameContext {
    return this.__frameContext
  }

  /**
   * Вернуть текущее число updates per second.
   */
  get ups(): number {
    return this.__ups
  }

  /**
   * Вернуть текущее число events per second.
   */
  get eps(): number {
    return this.__eps
  }

  /**
   * Вернуть текущее число changed nodes per second.
   */
  get nps(): number {
    return this.__nps
  }

  /**
   * Вернуть верхний лимит обновлений в секунду.
   */
  get maxUps(): number {
    return this._maxUps
  }

  /**
   * Вернуть минимальный интервал между обновлениями.
   */
  get minUpdateInterval(): number {
    return this._minUpdateInterval
  }

  /**
   * Вернуть текущий data adapter приложения.
   */
  get dataAdapter(): DataAdapter {
    return this._kernel.dataAdapter
  }

  /**
   * Возвращает kernel.
   */
  get kernel(): RaphKernel {
    return this._kernel
  }

  /** Вернуть фазы в порядке исполнения. */
  get phases(): ReadonlyArray<RaphPhase> {
    return this._phasesArray
  }

  /** Получить фазу по имени. */
  getPhase(name: PhaseName): RaphPhase | undefined {
    return this._phasesMap.get(name)
  }

  /**
   * Возвращает root.
   */
  get root(): RaphNode<Props> {
    return this._root
  }

  /**
   * Возвращает ups.
   */
  get UPS(): number {
    return this.__ups
  }
}
