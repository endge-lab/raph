import type { RaphNode } from '@/domain/core/RaphNode'
import type { RaphRouter } from '@/domain/core/RaphRouter'
import type { DataPathDef, MatchParams } from '@/domain/types/base.types'
import type {
  ControlFlowCallback,
  ControlFlowSubscribeOptions,
  ControlFlowSubscriptionId,
  ControlFlowSubscriptionRecord,
} from '@/domain/types/control-flow.types'

import { DataPath } from '@/domain/entities/DataPath'

/**
 * Централизованное хранилище подписок control flow.
 * Отвечает за:
 *  - регистрацию mask -> subscriptionId
 *  - lifecycle cleanup по owner-ноду
 *  - быстрый match подписок при notify
 */
export class ControlFlowRegistry {
  /**
   * Роутер подписок.
   * На уровне маршрутизации payload = subscriptionId,
   * чтобы callback выбирался без поиска внутри owner-ноды.
   */
  private _router: RaphRouter<ControlFlowSubscriptionId>

  /**
   * Основной реестр подписок.
   */
  private _subscriptions = new Map<
    ControlFlowSubscriptionId,
    ControlFlowSubscriptionRecord
  >()

  /**
   * Индекс owner-ноды -> множество subscriptionId.
   * Нужен для гарантированного cleanup без утечек ресурсов.
   */
  private _subscriptionsByOwner = new Map<string, Set<ControlFlowSubscriptionId>>()

  /**
   * Внутренний генератор идентификаторов подписок.
   */
  private _subscriptionCounter = 0

  /**
   * Создает instance и подготавливает внутреннее состояние.
   */
  constructor(router: RaphRouter<ControlFlowSubscriptionId>) {
    this._router = router
  }

  /**
   * Зарегистрировать подписку control flow.
   */
  subscribe(
    ownerNode: RaphNode<any>,
    maskOrMasks: DataPathDef | DataPathDef[],
    callback: ControlFlowCallback,
    opts?: ControlFlowSubscribeOptions,
  ): ControlFlowSubscriptionRecord {
    const masks = Array.isArray(maskOrMasks) ? maskOrMasks : [maskOrMasks]
    const routes = masks.map(mask => DataPath.from(mask, opts))
    const id = `__control.${this._subscriptionCounter++}`
    const record: ControlFlowSubscriptionRecord = {
      id,
      ownerId: ownerNode.id,
      ownerNode,
      masks,
      routes,
      callback,
      weight: opts?.weight ?? ownerNode.weight ?? 0,
    }

    this._subscriptions.set(id, record)

    let ownerSubscriptions = this._subscriptionsByOwner.get(ownerNode.id)
    if (!ownerSubscriptions) {
      ownerSubscriptions = new Set()
      this._subscriptionsByOwner.set(ownerNode.id, ownerSubscriptions)
    }
    ownerSubscriptions.add(id)

    for (const route of routes) {
      this._router.add(route, id)
    }

    return record
  }

  /**
   * Снять одну подписку по её идентификатору.
   */
  unsubscribe(subscriptionId: ControlFlowSubscriptionId): void {
    const record = this._subscriptions.get(subscriptionId)
    if (!record) {
      return
    }

    for (const route of record.routes) {
      this._router.remove(route, subscriptionId)
    }

    this._subscriptions.delete(subscriptionId)

    const ownerSubscriptions = this._subscriptionsByOwner.get(record.ownerId)
    if (!ownerSubscriptions) {
      return
    }

    ownerSubscriptions.delete(subscriptionId)
    if (ownerSubscriptions.size === 0) {
      this._subscriptionsByOwner.delete(record.ownerId)
    }
  }

  /**
   * Снять все подписки owner-ноды.
   */
  unsubscribeOwner(ownerId: string): void {
    const ownerSubscriptions = this._subscriptionsByOwner.get(ownerId)
    if (!ownerSubscriptions) {
      return
    }

    for (const subscriptionId of [...ownerSubscriptions]) {
      this.unsubscribe(subscriptionId)
    }
  }

  /**
   * Получить все подписки owner-ноды.
   * Возвращает снимок массива, чтобы вызывающая сторона могла безопасно итерироваться.
   */
  getSubscriptionIdsByOwner(ownerId: string): ControlFlowSubscriptionId[] {
    return [...(this._subscriptionsByOwner.get(ownerId) ?? [])]
  }

  /**
   * Получить запись подписки по идентификатору.
   */
  get(
    subscriptionId: ControlFlowSubscriptionId,
  ): ControlFlowSubscriptionRecord | undefined {
    return this._subscriptions.get(subscriptionId)
  }

  /**
   * Выполнить match подписок по каноническому пути.
   * Возвращает уже дедуплицированные записи.
   */
  match(
    canonicalPath: DataPathDef,
  ): Array<{
    record: ControlFlowSubscriptionRecord
    params?: MatchParams
  }> {
    const hits = this._router.matchWithParams(canonicalPath)
    if (hits.length === 0) {
      return []
    }

    const unique = new Map<
      ControlFlowSubscriptionId,
      {
        record: ControlFlowSubscriptionRecord
        params?: MatchParams
      }
    >()

    for (const hit of hits) {
      const record = this._subscriptions.get(hit.payload)
      if (!record || unique.has(record.id)) {
        continue
      }

      unique.set(record.id, {
        record,
        params: hit.params,
      })
    }

    return [...unique.values()]
  }

  /**
   * Полная очистка registry.
   */
  clear(): void {
    for (const record of this._subscriptions.values()) {
      for (const route of record.routes) {
        this._router.remove(route, record.id)
      }
    }

    this._subscriptions.clear()
    this._subscriptionsByOwner.clear()
  }

  /**
   * Есть ли сейчас хотя бы одна активная подписка.
   */
  get hasSubscriptions(): boolean {
    return this._subscriptions.size > 0
  }
}
