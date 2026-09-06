import type { RaphNode } from '@/domain/core/RaphNode'
import type { RaphRuntime } from '@/domain/core/RaphRuntime'
import type { DataPath } from '@/domain/entities/DataPath'
import type { DataPathDef, RaphProperties } from '@/domain/types/base.types'
import type { PhaseName, Traversal } from '@/domain/types/phase.types'

export type RaphMetaMutationKind = 'set' | 'merge' | 'delete'
export type RaphMetaMutationCause = 'explicit' | 'owner-delete' | 'owner-replaced' | 'clear'

/** Отдельное событие изменения пользовательской metadata, не являющееся data event. */
export interface RaphMetaMutationEvent {
  kind: RaphMetaMutationKind
  path: DataPath
  namespace: string | null
  cause: RaphMetaMutationCause
}

export interface RaphMetaReadOptions {
  vars?: Record<string, unknown>
}

export interface RaphMetaWriteOptions extends RaphMetaReadOptions {
  invalidate?: boolean
}

export interface RaphMetaWatchOptions extends RaphMetaReadOptions {
  namespace?: string
  wildcardDynamic?: boolean
  weight?: number
}

export type RaphMetaWatchCallback = (payload: { events: RaphMetaMutationEvent[] }) => void

export interface RaphObserveMetaOptions extends RaphMetaWatchOptions {
  phase: PhaseName | string
  traversal?: Traversal
}

export interface RaphMetaObserver<Props extends RaphProperties = RaphProperties> {
  readonly id: string
  readonly runtime: RaphRuntime<Props>
  readonly node: RaphNode<any>
  readonly mask: DataPathDef
  readonly namespace?: string
  readonly phase: PhaseName | string
  readonly traversal?: Traversal
  readonly vars?: Record<string, unknown>
  readonly wildcardDynamic?: boolean
}

export interface RaphPendingMetaMutationEvent extends RaphMetaMutationEvent {
  invalidate: boolean
}
