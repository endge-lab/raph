import type { MatchParams } from '@/domain/types/base.types'
import type {
  ControlFlowSubscriptionRecord,
  DirtyControlFlowSubscription,
} from '@/domain/types/control-flow.types'
import type { PhaseEvent } from '@/domain/types/phase.types'

/**
 * Очередь dirty-подписок control flow.
 * Батчит все совпадения в пределах одного тика и затем flush'ит callbacks
 * после стабилизации основного dataflow-контура.
 */
export class ControlFlowQueue {
  /**
   * Внутренний буфер dirty-подписок.
   */
  private _dirty = new Map<string, DirtyControlFlowSubscription>()

  /**
   * Поставить подписку в очередь на исполнение.
   */
  enqueue(
    record: ControlFlowSubscriptionRecord,
    event: PhaseEvent,
    params?: MatchParams,
  ): boolean {
    const existing = this._dirty.get(record.id)
    if (existing) {
      existing.matches.push({ event, params })
      return true
    }

    this._dirty.set(record.id, {
      subscriptionId: record.id,
      ownerId: record.ownerId,
      weight: record.weight,
      matches: [{ event, params }],
    })

    return true
  }

  /**
   * Удалить pending-элементы конкретной подписки.
   * Нужен для гарантированного cleanup при unsubscribe/remove owner.
   */
  delete(subscriptionId: string): void {
    this._dirty.delete(subscriptionId)
  }

  /**
   * Полностью очистить очередь.
   */
  clear(): void {
    this._dirty.clear()
  }

  /**
   * Сбросить очередь и вызвать callbacks в порядке приоритетов.
   */
  flush(
    getRecord: (
      subscriptionId: string,
    ) => ControlFlowSubscriptionRecord | undefined,
  ): void {
    if (this._dirty.size === 0) {
      return
    }

    const queue = [...this._dirty.values()]
      .sort((a, b) => b.weight - a.weight)

    this._dirty.clear()

    for (const item of queue) {
      const record = getRecord(item.subscriptionId)
      if (!record) {
        continue
      }

      record.callback({
        events: item.matches.map(match => match.event),
        params: item.matches[0]?.params,
        matches: item.matches,
      })
    }
  }

  /**
   * Есть ли сейчас накопленные dirty-подписки.
   */
  get hasDirty(): boolean {
    return this._dirty.size > 0
  }
}
