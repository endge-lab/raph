//
import type { PhaseEvent } from '@/domain/types/phase.types'

/**
 * Описывает тип EffectCleanup.
 */
export type EffectCleanup = void | (() => void)

//
/**
 * Описывает контракт RaphEffectOptions.
 */
export interface RaphEffectOptions {
  //
  id: string

  //
  weight?: number

  // Выполнить эффект сразу (захватить зависимости)
  immediate?: boolean
}

//
/**
 * Описывает тип WatchCallback.
 */
export type WatchCallback = (payload: { events: PhaseEvent[] }) => void
