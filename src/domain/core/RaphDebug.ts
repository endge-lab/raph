import type { RaphNode } from '@/domain/core/RaphNode'
import type { RaphRuntime } from '@/domain/core/RaphRuntime'
import type { EventBus } from '@/utils/EventBus'

/**
 * Описывает тип EventOff.
 */
type EventOff = () => void

export interface RaphDebugLease {
  release: () => void
}

/**
 * Описывает настройки RaphDebug.
 */
interface RaphDebugOptions {
  getApp: () => RaphRuntime<any>
  events: EventBus<any>
}

/**
 * Описывает тип NodeInfo.
 */
interface NodeInfo {
  id: string
  type?: string
  routes: Set<string>
  parents: Set<string>
  children: Set<string>
}

/**
 * Описывает тип NodeTree.
 */
export interface NodeTree {
  id: string
  type?: string
  children: Array<NodeTree>
  routes: Array<string>
}

/**
 * Описывает тип NodeFlatDump.
 */
export interface NodeFlatDump {
  id: string
  type?: string
  parentIds: Array<string>
  childIds: Array<string>
  routes: Array<string>
}

/**
 * Собирает debug-метрики Raph phases и dirty processing.
 */
export class RaphDebug {
  private _enabled = false
  private _manuallyEnabled = false
  private _leases = new Set<symbol>()
  private _off: Array<EventOff> = []
  private _getApp?: () => RaphRuntime<any>
  private _events?: EventBus<any>

  // id -> агрегированная инфа (подписки + связи)
  private _nodes = new Map<string, NodeInfo>()

  /** Вкл/выкл отладчик (подписки/отписки на события) */
  /**
   * Настроить источники runtime/event bus.
   */
  configure(options: RaphDebugOptions): void {
    this._getApp = options.getApp
    this._events = options.events
  }

  /** Вкл/выкл отладчик (подписки/отписки на события) */
  /**
   * Подключить или отключить debug-слежение за графом и маршрутами.
   */
  enable(value: boolean): void {
    this._manuallyEnabled = value
    this._syncEnabled()
  }

  /** Сохраняет debug активным на протяжении явной сессии инспекции. */
  acquire(): RaphDebugLease {
    const token = Symbol('raph-debug-lease')
    this._leases.add(token)
    this._syncEnabled()
    let released = false
    return {
      release: () => {
        if (released) {
          return
        }
        released = true
        this._leases.delete(token)
        this._syncEnabled()
      },
    }
  }

  /** Жёсткая очистка состояния (не трогает флаги enable/disable) */
  /**
   * Очистить накопленное debug-состояние.
   */
  clear(): void {
    this._nodes.clear()
  }

  /** Явный рефреш графовой иерархии (без сброса подписок) */
  /**
   * Пересобрать snapshot иерархии из текущего графа.
   */
  refresh(): void {
    this._rebuildHierarchyFromGraph()
  }

  /** Плоский дамп для таблицы/списка */
  /**
   * Вернуть плоский snapshot нод для таблиц и инспекторов.
   */
  getFlat(): Array<NodeFlatDump> {
    const out: Array<NodeFlatDump> = []
    for (const [id, info] of this._nodes) {
      out.push({
        id,
        type: info.type,
        parentIds: [...info.parents].sort(),
        childIds: [...info.children].sort(),
        routes: [...info.routes].sort(),
      })
    }
    out.sort((a, b) => a.id.localeCompare(b.id))
    return out
  }

  /** Дерево для UI: у узла - дети и далее его подписки */
  /**
   * Вернуть дерево нод для визуального отображения.
   */
  getTree(): Array<NodeTree> {
    const app = this._getApp?.()
    if (!app) {
      return []
    }

    const roots = Array.from(app.graph.roots())
    const seen = new Set<string>()

    const build = (n: RaphNode): NodeTree => {
      const info = this._ensureInfo(n)
      const kids = Array.from(app.graph.childrenOf(n))
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(ch => build(ch))
      seen.add(n.id)
      return {
        id: n.id,
        type: n.type,
        children: kids,
        routes: [...info.routes].sort(),
      }
    }

    const forest = Array.from(roots)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(r => build(r))

    for (const id of this._nodes.keys()) {
      if (seen.has(id)) {
        continue
      }
      const n = app.getNode(id)
      if (n) {
        forest.push(build(n))
      }
    }

    return forest
  }

  // ================== ВНУТРЕННЕЕ ==================

  /**
   * Подписаться на события Raph и начать сбор debug-данных.
   */
  private _attach(): void {
    this._enabled = true
    const events = this._events
    const app = this._getApp?.()
    if (!events || !app) {
      return
    }

    // 1) Иерархия графа изменилась
    this._off.push(
      events.on('nodes:changed', () => {
        this._rebuildHierarchyFromGraph()
        events.emit('debug:nodes', {})
      }),
    )

    // 2) Узел подписался на маску
    this._off.push(
      events.on('node:tracked', (p: { node: RaphNode, path: string }) => {
        const info = this._ensureInfo(p.node)
        if (typeof p.path === 'string' && p.path) {
          info.routes.add(p.path)
        }
        events.emit('debug:nodes', {})
      }),
    )

    this._off.push(
      events.on('node:untracked', (p: { node: RaphNode, path?: string }) => {
        const info = this._nodes.get(p.node.id)
        if (!info) {
          return
        }
        if (p.path) {
          info.routes.delete(p.path)
        }
        else { info.routes.clear() }
        events.emit('debug:nodes', {})
      }),
    )

    // 3) При каждом батче уведомлений считаем метрику и пушим в bus
    this._off.push(
      events.on(
        'nodes:notified',
        (_payload: {
          ctxs: Array<{ phase: string, node: RaphNode, events?: Array<any> }>
        }) => {
          const currentApp = this._getApp?.()
          if (!currentApp) {
            return
          }
          events.emit('debug:metrics', {
            ups: currentApp.ups,
            eps: currentApp.eps,
            nps: currentApp.nps,
          })
        },
      ),
    )

    // первичный прогон
    this._rebuildHierarchyFromGraph()
  }

  /**
   * Отписаться от событий Raph.
   */
  private _detach(): void {
    this._enabled = false
    for (const f of this._off) {
      try {
        f()
      }
      catch {
        //
      }
    }
    this._off = []
  }

  private _syncEnabled(): void {
    const next = this._manuallyEnabled || this._leases.size > 0
    if (next === this._enabled) {
      return
    }
    if (next) {
      this._attach()
      return
    }
    this._detach()
    this.clear()
  }

  /**
   * Получить или создать агрегированную debug-информацию по ноде.
   */
  private _ensureInfo(node: RaphNode): NodeInfo {
    const id = node.id
    let info = this._nodes.get(id)
    if (!info) {
      info = {
        id,
        type: node.type,
        routes: new Set<string>(),
        parents: new Set<string>(),
        children: new Set<string>(),
      }
      this._nodes.set(id, info)
    }
    else if (!info.type && node.type) {
      info.type = node.type
    }
    return info
  }

  /** Пересборка живой иерархии и маршрутов из runtime graph/router. */
  private _rebuildHierarchyFromGraph(): void {
    const app = this._getApp?.()
    if (!app) {
      return
    }

    for (const info of this._nodes.values()) {
      info.parents.clear()
      info.children.clear()
      info.routes.clear()
    }

    const seen = new Set<string>()
    const dfs = (n: RaphNode) => {
      if (!seen.add(n.id)) {
        return
      }
      const cur = this._ensureInfo(n)
      for (const route of app.getTrackedMasks(n)) {
        cur.routes.add(route)
      }
      for (const ch of app.graph.childrenOf(n)) {
        const child = this._ensureInfo(ch)
        cur.children.add(ch.id)
        child.parents.add(n.id)
        dfs(ch)
      }
    }

    for (const r of app.graph.roots()) {
      dfs(r)
    }
    for (const [id] of this._nodes) {
      if (seen.has(id)) {
        continue
      }
      const n = app.getNode(id)
      if (n) {
        dfs(n)
      }
    }

    for (const [id] of Array.from(this._nodes.entries())) {
      if (app.getNode(id)) {
        continue
      }
      this._nodes.delete(id)
    }
  }
}
