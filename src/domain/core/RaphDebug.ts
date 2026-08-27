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
  private enabled = false
  private manuallyEnabled = false
  private leases = new Set<symbol>()
  private off: Array<EventOff> = []
  private getApp?: () => RaphRuntime<any>
  private events?: EventBus<any>

  // id -> агрегированная инфа (подписки + связи)
  private nodes = new Map<string, NodeInfo>()

  /** Вкл/выкл отладчик (подписки/отписки на события) */
  /**
   * Настроить источники runtime/event bus.
   */
  configure(options: RaphDebugOptions): void {
    this.getApp = options.getApp
    this.events = options.events
  }

  /** Вкл/выкл отладчик (подписки/отписки на события) */
  /**
   * Подключить или отключить debug-слежение за графом и маршрутами.
   */
  enable(value: boolean): void {
    this.manuallyEnabled = value
    this.syncEnabled()
  }

  /** Keep debug active for the lifetime of an explicit inspection session. */
  acquire(): RaphDebugLease {
    const token = Symbol('raph-debug-lease')
    this.leases.add(token)
    this.syncEnabled()
    let released = false
    return {
      release: () => {
        if (released) {
          return
        }
        released = true
        this.leases.delete(token)
        this.syncEnabled()
      },
    }
  }

  /** Жёсткая очистка состояния (не трогает флаги enable/disable) */
  /**
   * Очистить накопленное debug-состояние.
   */
  clear(): void {
    this.nodes.clear()
  }

  /** Явный рефреш графовой иерархии (без сброса подписок) */
  /**
   * Пересобрать snapshot иерархии из текущего графа.
   */
  refresh(): void {
    this.rebuildHierarchyFromGraph()
  }

  /** Плоский дамп для таблицы/списка */
  /**
   * Вернуть плоский snapshot нод для таблиц и инспекторов.
   */
  getFlat(): Array<NodeFlatDump> {
    const out: Array<NodeFlatDump> = []
    for (const [id, info] of this.nodes) {
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
    const app = this.getApp?.()
    if (!app) {
      return []
    }

    const roots = Array.from(app.graph.roots())
    const seen = new Set<string>()

    const build = (n: RaphNode): NodeTree => {
      const info = this.ensureInfo(n)
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

    for (const id of this.nodes.keys()) {
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

  // ================== INTERNAL ==================

  /**
   * Подписаться на события Raph и начать сбор debug-данных.
   */
  private attach(): void {
    this.enabled = true
    const events = this.events
    const app = this.getApp?.()
    if (!events || !app) {
      return
    }

    // 1) Иерархия графа изменилась
    this.off.push(
      events.on('nodes:changed', () => {
        this.rebuildHierarchyFromGraph()
        events.emit('debug:nodes', {})
      }),
    )

    // 2) Узел подписался на маску
    this.off.push(
      events.on('node:tracked', (p: { node: RaphNode, path: string }) => {
        const info = this.ensureInfo(p.node)
        if (typeof p.path === 'string' && p.path) {
          info.routes.add(p.path)
        }
        events.emit('debug:nodes', {})
      }),
    )

    this.off.push(
      events.on('node:untracked', (p: { node: RaphNode, path?: string }) => {
        const info = this.nodes.get(p.node.id)
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
    this.off.push(
      events.on(
        'nodes:notified',
        (_payload: {
          ctxs: Array<{ phase: string, node: RaphNode, events?: Array<any> }>
        }) => {
          const currentApp = this.getApp?.()
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
    this.rebuildHierarchyFromGraph()
  }

  /**
   * Отписаться от событий Raph.
   */
  private detach(): void {
    this.enabled = false
    for (const f of this.off) {
      try {
        f()
      }
      catch {
        //
      }
    }
    this.off = []
  }

  private syncEnabled(): void {
    const next = this.manuallyEnabled || this.leases.size > 0
    if (next === this.enabled) {
      return
    }
    if (next) {
      this.attach()
      return
    }
    this.detach()
    this.clear()
  }

  /**
   * Получить или создать агрегированную debug-информацию по ноде.
   */
  private ensureInfo(node: RaphNode): NodeInfo {
    const id = node.id
    let info = this.nodes.get(id)
    if (!info) {
      info = {
        id,
        type: node.type,
        routes: new Set<string>(),
        parents: new Set<string>(),
        children: new Set<string>(),
      }
      this.nodes.set(id, info)
    }
    else if (!info.type && node.type) {
      info.type = node.type
    }
    return info
  }

  /** Пересборка живой иерархии и маршрутов из runtime graph/router. */
  private rebuildHierarchyFromGraph(): void {
    const app = this.getApp?.()
    if (!app) {
      return
    }

    for (const info of this.nodes.values()) {
      info.parents.clear()
      info.children.clear()
      info.routes.clear()
    }

    const seen = new Set<string>()
    const dfs = (n: RaphNode) => {
      if (!seen.add(n.id)) {
        return
      }
      const cur = this.ensureInfo(n)
      for (const route of app.getTrackedMasks(n)) {
        cur.routes.add(route)
      }
      for (const ch of app.graph.childrenOf(n)) {
        const child = this.ensureInfo(ch)
        cur.children.add(ch.id)
        child.parents.add(n.id)
        dfs(ch)
      }
    }

    for (const r of app.graph.roots()) {
      dfs(r)
    }
    for (const [id] of this.nodes) {
      if (seen.has(id)) {
        continue
      }
      const n = app.getNode(id)
      if (n) {
        dfs(n)
      }
    }

    for (const [id] of Array.from(this.nodes.entries())) {
      if (app.getNode(id)) {
        continue
      }
      this.nodes.delete(id)
    }
  }
}
