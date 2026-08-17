import type { RaphDerivedNode } from '@/domain/derived/RaphDerivedNode'
import type { DataPath } from '@/domain/entities/DataPath'
import type { DataPathDef } from '@/domain/types/base.types'

export type RaphDerivedStatus = 'active' | 'paused' | 'error' | 'disposed'
export type RaphDerivedDisposeTarget = 'keep' | 'delete'
export type RaphDerivedMutationKind = 'set' | 'merge' | 'delete' | 'notify' | 'derived'
export type RaphDerivedKey = string | number

export interface RaphDerivedFullStrategy {
  readonly kind: 'full'
}

export interface RaphDerivedCollectionByKeyStrategy {
  readonly kind: 'collection-by-key'
  readonly key: string
}

export interface RaphDerivedFilterByKeyStrategy {
  readonly kind: 'filter-by-key'
  readonly key: string
}

export type RaphDerivedStrategy
  = | RaphDerivedFullStrategy
    | RaphDerivedCollectionByKeyStrategy
    | RaphDerivedFilterByKeyStrategy

export interface RaphDerivedOptions<TSource = unknown, TTarget = unknown> {
  id?: string
  from: DataPathDef
  to: DataPathDef
  strategy?: RaphDerivedStrategy
  compute: (source: TSource) => TTarget
  immediate?: boolean
  disposeTarget?: RaphDerivedDisposeTarget
}

export interface RaphDerivedMutationRecord {
  kind: RaphDerivedMutationKind
  path: DataPath
  originalPath: DataPathDef
  opts?: { invalidate?: boolean, vars?: Record<string, any> }
  originDerivedId?: string
}

export interface RaphDerivedNodeSnapshot {
  id: string
  status: RaphDerivedStatus
  from: string
  to: string
  strategy: RaphDerivedStrategy['kind']
  computeCount: number
  fullComputeCount: number
  incrementalComputeCount: number
  targetWriteCount: number
  stale: boolean
  lastError: string | null
}

export interface RaphDerivedHandleSnapshot extends RaphDerivedNodeSnapshot {
  disposeTarget: RaphDerivedDisposeTarget
}

export interface RaphDerivedManagerSnapshot {
  registrations: number
  graphNodes: number
  graphEdges: number
  sourceRoutes: number
  targetRoutes: number
  dirtyHandles: number
  pendingKeys: number
  errors: number
  stabilizing: boolean
}

export interface RaphDerivedHandleContract {
  readonly id: string
  readonly node: RaphDerivedNode
  readonly status: RaphDerivedStatus
  readonly lastError: Error | null
  pause(): void
  resume(): void
  recompute(): void
  dispose(): void
  snapshot(): RaphDerivedHandleSnapshot
}

export class RaphDerivedError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = new.target.name
  }
}

export class RaphDerivedComputeError extends RaphDerivedError {
  public readonly derivedId: string

  public constructor(derivedId: string, cause: unknown) {
    super(`[RaphDerived] Compute failed for "${derivedId}": ${errorMessage(cause)}`, { cause })
    this.derivedId = derivedId
  }
}

export class RaphDerivedStrategyError extends RaphDerivedError {}
export class RaphDerivedCycleError extends RaphDerivedError {}
export class RaphDerivedPathError extends RaphDerivedError {}
export class RaphDerivedTargetWriteError extends RaphDerivedError {}
export class RaphDerivedDisposedError extends RaphDerivedError {}
export class RaphDerivedReentrancyError extends RaphDerivedError {}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
