import type { RaphNode } from '@/domain/core/RaphNode'
import type { RaphRuntime } from '@/domain/core/RaphRuntime'
import type { DataPathDef, RaphProperties, SchedulerType } from '@/domain/types/base.types'
import type { PhaseEvent, PhaseName, Traversal } from '@/domain/types/phase.types'

/**
 * Описывает настройки Raph runtime lane.
 */
export interface RaphRuntimeOptions {
  id?: string
  scheduler?: SchedulerType
}

/**
 * Описывает настройки data observer.
 */
export interface RaphObserveDataOptions {
  phase: PhaseName | string
  traversal?: Traversal
  vars?: Record<string, any>
  wildcardDynamic?: boolean
}

/**
 * Описывает подписку runtime-ноды на business data path.
 */
export interface RaphDataObserver<Props extends RaphProperties = RaphProperties> {
  readonly id: string
  readonly runtime: RaphRuntime<Props>
  readonly node: RaphNode<any>
  readonly mask: DataPathDef
  readonly phase: PhaseName | string
  readonly traversal?: Traversal
  readonly vars?: Record<string, any>
  readonly wildcardDynamic?: boolean
}

/**
 * Описывает pending path change внутри kernel transaction.
 */
export interface RaphKernelPendingEvent {
  path: DataPathDef
  opts?: {
    invalidate?: boolean
    vars?: Record<string, any>
  }
}

/**
 * Описывает результат доставки data event в runtime.
 */
export interface RaphRuntimeNotifyResult {
  runtime: RaphRuntime<any>
  affected: boolean
  invalidate: boolean
  event?: PhaseEvent
}
