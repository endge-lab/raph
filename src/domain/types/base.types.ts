import type { StableKey, StableMaskKey } from '@/domain/types/path.types'
import type { DataPath } from '@/domain/entities/DataPath'
import type { RaphNode } from '@/domain/core/RaphNode'
import type { PhaseEvent } from '@/domain/types/phase.types'
import type { MinHeap } from '@/domain/entities/MinHeap'
import type { Branded } from '@/domain/types/brand.types'

/**
 * Настройки RaphApp
 */
export interface RaphOptions {
  debug: boolean
  maxUps: number
  scheduler: SchedulerType
  adapter: DataAdapter
  priority: RaphPriorityStrategy
}

/**
 * Описание вариантов описания пути
 */
export type DataPathDef =
  | StableKey
  | StableMaskKey
  | string
  | DataPath
  | Record<string, any>

/**
 * Интерфейс адаптера данных для RaphApp
 */
export interface DataAdapter {
  root(): DataObject
  get(
    path: DataPathDef,
    opts?: { vars?: Record<string, any> },
  ): Undefinable<unknown>
  set(
    path: DataPathDef,
    value: unknown,
    opts?: { vars?: Record<string, any> },
  ): void
  delete(path: DataPathDef, opts?: { vars?: Record<string, any> }): void
  merge(
    path: DataPathDef,
    value: unknown,
    opts?: { vars?: Record<string, any> },
  ): void
  indexOf(path: DataPathDef, opts?: { vars?: Record<string, any> }): number
}

/**
 * Настройки адаптера данных по умолчанию
 */
export interface DefaultAdapterOptions {
  /** Как удалять из массивов: удалить элемент (splice) или оставить дырку (unset). */
  arrayDelete?: 'splice' | 'unset'

  /** Создавать промежуточные контейнеры: объект или массив определяется типом следующего сегмента. */
  autoCreate?: boolean

  /** Ленивая индексация массивов для arr[pkey=pval] */
  indexEnabled?: boolean
  indexStrategy: 'lazy-key' | 'eager-all-keys'
}

/**
 * Тип для корневого объекта адаптера данных
 */
export type DataObject = Record<string | number, any>

/**
 * Планировщик для запуска фаз
 */
export enum SchedulerType {
  Sync = 'sync',
  Microtask = 'microtask',
  AnimationFrame = 'animationFrame',
}

/**
 * Описывает тип RaphPriorityStrategy.
 */
export type RaphPriorityStrategy = 'depth-weight-desc' | 'legacy-depth-weight-asc'

/**
 * Планировщик для запуска фаз RaphApp.
 */
export type RaphScheduler = (cb: VoidFunction) => void

/**
 * Описывает контракт RaphFrameContext.
 */
export interface RaphFrameContext {
  now: number
  delta: number
  elapsed: number
  frame: number
}

/**
 * Описывает контракт RaphLoopLease.
 */
export interface RaphLoopLease {
  readonly owner: string
  release(): void
}

/**
 * Данные фазы для обработки грязных узлов
 */
export type PhaseDirty = {
  // key = computedWeight -> список нод
  buckets: Map<number, Array<RaphNode<any>>>
  events: Map<string, Array<PhaseEvent>>

  // мин-куча индексов активных бакетов (минимальный индекс = к следующей обработке)
  heap: MinHeap

  // set для дедупликации индексов внутри кучи
  inHeap: Set<number>
}

/**
 * Описывает тип RaphNodeType.
 */
export type RaphNodeType = Branded<string, 'RaphNodeType'>

/**
 * Описывает тип MatchParams.
 */
export type MatchParams = Record<string, unknown>

/**
 * Описывает тип Undefinable.
 */
export type Undefinable<T> = T | undefined

/**
 * Описывает тип RaphPropertyName.
 */
export type RaphPropertyName = string

/**
 * Описывает тип RaphProperties.
 */
export type RaphProperties = Record<RaphPropertyName, unknown> & {
  weight?: number
}
