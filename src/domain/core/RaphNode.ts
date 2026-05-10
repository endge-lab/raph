import type { RaphApp } from '@/domain/core/RaphApp'
import type { RaphProperties } from '@/domain/types/base.types'
import type { PhaseName } from '@/domain/types/phase.types'

/**
 * Описывает тип RaphNodeOptions.
 */
type RaphNodeOptions = {
  id?: string
  weight?: number
  meta?: Record<string, unknown>
  type?: string
}

/**
 * Описывает тип RaphAddChildOptions.
 */
type RaphAddChildOptions = {
  invalidate?: boolean
}

/**
 * Описывает тип RaphLocalApi.
 */
type RaphLocalApi<P extends RaphProperties> = {
  get: <K extends keyof P>(key: K) => P[K]
  set: <K extends keyof P>(key: K, value: P[K]) => void
}

/**
 * Описывает базовый узел Raph graph с properties, parent-child связями и dirty state.
 */
export class RaphNode<P extends RaphProperties = RaphProperties> {
  //
  // Системные
  //

  //
  private _id: string

  // тип узла, по умолчанию 'default'
  private _type: string = 'default'

  //
  private _app: RaphApp<any>

  // пользовательское значение приоритета обработки (на одном уровне)
  private _weight: number = 0

  // пользовательское значение приоритета обработки (на одном уровне)
  private _meta: Record<string, unknown> = {}

  // ordered tree для instant/local сценариев
  private _parent: RaphNode<any> | null = null
  private _children: RaphNode<any>[] = []

  // local values не проходят через DataAdapter
  private _localValues: Record<string, unknown> = {}

  // Битовая маска с информацией, для какой фазы узел требует обработки
  private __dirtyPhasesMask: number = 0

  //
  private static __nodeCounter = 0

  //
  //
  /**
   * Создает instance и подготавливает внутреннее состояние.
   */
  constructor(
    app: RaphApp<any>,
    opts?: RaphNodeOptions,
  ) {
    this._app = app

    this._id = `node-${RaphNode.__nodeCounter++}`
    if (opts?.id) {
      this._id = opts.id
    }
    if (opts?.weight) {
      this._weight = opts.weight
    }
    if (opts?.meta) {
      this._meta = opts.meta
    }
    if (opts?.type) {
      this._type = opts.type
    }
  }

  //
  // PUBLIC API
  //

  /**
   * Добавить дочернюю ноду и связать её зависимостью с текущей.
   */
  addChild(node: RaphNode<any>, options: RaphAddChildOptions = {}): boolean {
    const invalidate = options.invalidate ?? true

    if (this._children.includes(node)) {
      return true
    }

    if (node._parent && node._parent !== this) {
      node._parent._children = node._parent._children.filter(child => child !== node)
    }

    node._parent = this
    node._attachApp(this._app)
    this._children.push(node)

    this._app.registerNode(node)
    const linked = this._app.addDependency(this, node)
    this._app.dirtyLocalNodeDefaults(node, invalidate)

    for (const child of node.children) {
      child._attachApp(this._app)
      this._app.registerNode(child)
      this._app.addDependency(node, child)
      this._app.dirtyLocalNodeDefaults(child, invalidate)
    }

    return linked
  }

  /**
   * Удалить ноду из приложения и сбросить её локальный приоритет.
   */
  remove(): void {
    this._app.removeNode(this)
    this._weight = 0
    this._parent = null
  }

  /**
   * Добавить или обновить метаданные ноды.
   */
  addMeta(key: string, value: unknown): void {
    this._meta[key] = value
  }

  /**
   * Выполняет внутреннюю операцию options.
   */
  options(opts: Partial<P> & RaphNodeOptions): this {
    const { id: _id, meta, type, weight, ...rest } = opts

    if (weight !== undefined) {
      this._weight = weight
    }
    if (meta !== undefined) {
      this._meta = { ...this._meta, ...meta }
    }
    if (type !== undefined) {
      this._type = type
    }

    const values = rest as Partial<P>
    for (const key of Object.keys(values) as (keyof P)[]) {
      const value = values[key]
      if (value !== undefined) {
        this.set(key, value as P[typeof key])
      }
    }

    return this
  }

  /**
   * Выполняет внутреннюю операцию get.
   */
  get<K extends keyof P>(key: K): P[K] {
    return this._app.getLocalProperty(key)?.get(this) ?? this.getLocal(key)
  }

  /**
   * Выполняет внутреннюю операцию set.
   */
  set<K extends keyof P>(key: K, value: P[K]): void {
    const property = this._app.getLocalProperty(key)
    if (property) {
      property.set(this, value)
      return
    }

    this.setLocal(key, value)
  }

  /**
   * Возвращает local.
   */
  getLocal<K extends keyof P>(key: K): P[K] {
    return this._localValues[String(key)] as P[K]
  }

  /**
   * Обновляет local.
   */
  setLocal<K extends keyof P>(key: K, value: P[K]): void {
    this._localValues[String(key)] = value
  }

  /**
   * Выполняет внутреннюю операцию dirty.
   */
  dirty(phase: PhaseName | string | Array<PhaseName | string>): void {
    if (Array.isArray(phase)) {
      for (const p of phase) {
        this._app.dirty(p as PhaseName, this)
      }
      return
    }

    this._app.dirty(phase as PhaseName, this)
  }

  /**
   * Выполняет внутреннюю операцию traverse all.
   */
  traverseAll(cb: (node: RaphNode<any>) => void): void {
    cb(this)
    for (const child of this._children) {
      child.traverseAll(cb)
    }
  }

  /**
   * Выполняет внутреннюю операцию dispose.
   */
  dispose(): void {
    for (const child of [...this._children]) {
      child.dispose()
    }

    this._children.length = 0
    this._parent = null
    this._localValues = {}
    this._weight = 0
    this._app.unregisterNode(this)
  }

  /**
   * Выполняет внутреннюю операцию attach app.
   */
  _attachApp(app: RaphApp<any>): void {
    this._app = app
    for (const child of this._children) {
      child._attachApp(app)
    }
  }

  /**
   * Проверяет наличие dirty phase.
   */
  hasDirtyPhase(bit: number): boolean {
    return Boolean(this.__dirtyPhasesMask & bit)
  }

  /**
   * Помечает dirty phase.
   */
  markDirtyPhase(bit: number): void {
    this.__dirtyPhasesMask |= bit
  }

  /**
   * Очищает dirty phase.
   */
  clearDirtyPhase(bit: number): void {
    this.__dirtyPhasesMask &= ~bit
  }

  //
  // ACCESS
  //

  /**
   * Вернуть приложение, которому принадлежит нода.
   */
  get app(): RaphApp<P> {
    return this._app as RaphApp<P>
  }

  /**
   * Возвращает raph.
   */
  get raph(): RaphApp<P> {
    return this._app as RaphApp<P>
  }

  /**
   * Вернуть идентификатор ноды.
   */
  get id(): string {
    return this._id
  }

  /**
   * Вернуть пользовательский вес ноды.
   */
  get weight(): number {
    return this._weight
  }

  /**
   * Возвращает computed weight.
   */
  get computedWeight(): number {
    return this._app.priorityOf(this)
  }

  /**
   * Вернуть метаданные ноды.
   */
  get meta(): Record<string, unknown> {
    return this._meta
  }

  /**
   * Вернуть тип ноды.
   */
  get type(): string {
    return this._type
  }

  /**
   * Возвращает parent.
   */
  get parent(): RaphNode<P> | null {
    return this._parent as RaphNode<P> | null
  }

  /**
   * Возвращает children.
   */
  get children(): RaphNode<P>[] {
    return this._children as RaphNode<P>[]
  }

  /**
   * Возвращает local.
   */
  get local(): RaphLocalApi<P> {
    return {
      get: key => this.getLocal(key),
      set: (key, value) => this.setLocal(key, value),
    }
  }
}
