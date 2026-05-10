import type { RaphNode } from '@/domain/core/RaphNode'
import type { DataPath } from '@/domain/entities/DataPath'
import type { DataPathDef, MatchParams } from '@/domain/types/base.types'
import type { PhaseEvent } from '@/domain/types/phase.types'

/**
 * Идентификатор подписки control flow.
 */
export type ControlFlowSubscriptionId = string

/**
 * Параметры создания подписки control flow.
 */
export interface ControlFlowSubscribeOptions {
  /**
   * Дополнительные переменные для разрешения mask.
   */
  vars?: Record<string, any>

  /**
   * Разрешать ли превращение динамических частей пути в wildcard при track.
   */
  wildcardDynamic?: boolean

  /**
   * Пользовательский приоритет исполнения.
   * Большее значение означает более ранний вызов callback.
   */
  weight?: number
}

/**
 * Один факт совпадения подписки с событием изменения данных.
 */
export interface ControlFlowMatch {
  /**
   * Событие изменения данных.
   */
  event: PhaseEvent

  /**
   * Захваченные параметры маски.
   */
  params?: MatchParams
}

/**
 * Полезная нагрузка, которую получает callback подписки.
 */
export interface ControlFlowPayload {
  /**
   * Батч событий текущего тика.
   */
  events: Array<PhaseEvent>

  /**
   * Первый набор захваченных параметров.
   * Нужен как короткий sugar для простых кейсов.
   */
  params?: MatchParams

  /**
   * Полный список совпадений текущего тика.
   * Нужен, чтобы не терять параметры при нескольких match за один flush.
   */
  matches: Array<ControlFlowMatch>
}

/**
 * Callback подписки control flow.
 */
export type ControlFlowCallback = (payload: ControlFlowPayload) => void

/**
 * Полная запись о подписке control flow.
 */
export interface ControlFlowSubscriptionRecord {
  /**
   * Уникальный идентификатор подписки.
   */
  id: ControlFlowSubscriptionId

  /**
   * Идентификатор owner-ноды, к которой привязана подписка.
   */
  ownerId: string

  /**
   * Сама owner-нода.
   * Хранится для отладки и возможного расширения API.
   */
  ownerNode: RaphNode<any>

  /**
   * Исходные маски, которые были переданы при подписке.
   */
  masks: Array<DataPathDef>

  /**
   * Нормализованные маршруты, зарегистрированные в роутере.
   */
  routes: Array<DataPath>

  /**
   * Callback, который вызывается после стабилизации dataflow-контура.
   */
  callback: ControlFlowCallback

  /**
   * Приоритет выполнения подписки.
   */
  weight: number
}

/**
 * Батч dirty-событий одной подписки за текущий тик.
 */
export interface DirtyControlFlowSubscription {
  /**
   * Идентификатор подписки.
   */
  subscriptionId: ControlFlowSubscriptionId

  /**
   * Идентификатор owner-ноды.
   */
  ownerId: string

  /**
   * Приоритет выполнения подписки.
   */
  weight: number

  /**
   * Полный список совпадений за тик.
   */
  matches: Array<ControlFlowMatch>
}
