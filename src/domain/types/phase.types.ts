import type { RaphNode } from '@/domain/core/RaphNode'
import type { DataPath } from '@/domain/entities/DataPath'
import type { RaphFrameContext, RaphNodeType } from '@/domain/types/base.types'
import type { Branded } from '@/domain/types/brand.types'

/**
 * Название фазы
 */
export type PhaseName = Branded<string, 'PhaseName'>

/**
 * Способы для обхода графа нод
 */
export type Traversal
  = | 'dirty-only' // только отмеченные ноды
    | 'dirty-and-down' // каждая грязная + её потомки (top-down)
    | 'dirty-and-up' // грязная + подниматься к предкам (bottom-up)
    | 'all' // все ноды в графе, начиная с _root

// Формат записи resolved
/**
 * Описывает тип ResolvedEntry.
 */
export interface ResolvedEntry {
  segment: string // имя контейнера, например "attrs" или "legs"
  keyField: string // pk/fk имя, например "legId"
  keyValue: unknown // исходное значение pval (строка с $ тоже норм), полезно для отладки
  index: number // индекс найденного элемента массива, -1 если не нашли
}

//
/**
 * Описывает тип PhaseEvent.
 */
export interface PhaseEvent {
  // исходный путь события
  original: string
  canonical: string
  canonicalDataPath: DataPath

  resolved: Array<ResolvedEntry>

  // захваченные параметры (если были)
  // params?: Record<string, unknown>
}

/**
 * Контекст выполнения фазы (для каждой ноды или для всех сразу)
 */
export interface PhaseExecutorContext {
  phase: PhaseName
  node: RaphNode<any>
  frame: RaphFrameContext
  events?: Array<PhaseEvent>
}

/**
 * Тип для функции, которая выполняет фазу
 */
export type PhaseEachExecutor = (
  ctx: PhaseExecutorContext,
) => unknown | Promise<unknown>

/**
 * Описывает тип PhaseAllExecutor.
 */
export type PhaseAllExecutor = (
  ctxs: Array<PhaseExecutorContext>,
) => unknown | Promise<unknown>

/**
 * Описание фазы RaphApp
 */
export interface RaphPhase {
  name: PhaseName
  traversal: Traversal
  routes: Array<string>
  always?: boolean
  mode?: 'dirty' | 'all'
  each?: PhaseEachExecutor
  all?: PhaseAllExecutor
  nodes?: ((node: RaphNode<any>) => boolean) | Array<RaphNodeType>
}
