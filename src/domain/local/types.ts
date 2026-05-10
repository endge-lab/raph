import type { RaphApp } from '@/domain/core/RaphApp'
import type { RaphNode } from '@/domain/core/RaphNode'
import type { RaphFrameContext, RaphProperties } from '@/domain/types/base.types'

/**
 * Описывает тип RaphLocalPhaseName.
 */
export type RaphLocalPhaseName = string

/**
 * Описывает набор значений RaphPropagation.
 */
export enum RaphPropagation {
  None = 'none',
  Down = 'down',
  Up = 'up',
}

/**
 * Описывает тип RaphLocalPhaseMode.
 */
export type RaphLocalPhaseMode = 'dirty' | 'all'

/**
 * Описывает тип RaphLocalPhaseRunner.
 */
export type RaphLocalPhaseRunner<P extends RaphProperties> = (
  payload: RaphLocalPhaseContext<P>,
) => void

/**
 * Описывает тип RaphLocalNodeCallback.
 */
export type RaphLocalNodeCallback<P extends RaphProperties> = (
  node: RaphNode<P>,
  phase: RaphLocalPhase<P>,
) => void

/**
 * Описывает тип RaphLocalPropertyCompute.
 */
export type RaphLocalPropertyCompute<P extends RaphProperties, K extends keyof P> = (
  node: RaphNode<P>,
) => P[K]

/**
 * Описывает контракт RaphLocalPropertyDescriptor.
 */
export interface RaphLocalPropertyDescriptor<
  P extends RaphProperties,
  K extends keyof P,
> {
  name: K
  phase: RaphLocalPhaseName
  propagation?: RaphPropagation
  compute?: RaphLocalPropertyCompute<P, K>
  dependsOn?: (keyof P)[]
  defaultValue?: P[K]
}

/**
 * Описывает контракт RaphLocalPhaseDescriptor.
 */
export interface RaphLocalPhaseDescriptor<P extends RaphProperties> {
  name: RaphLocalPhaseName
  process?: RaphLocalPhaseRunner<P>
  beforeProcess?: RaphLocalNodeCallback<P>
  afterProcess?: RaphLocalNodeCallback<P>
  always?: boolean
  mode?: RaphLocalPhaseMode
  priority?: number
}

/**
 * Описывает контракт RaphLocalPhase.
 */
export interface RaphLocalPhase<P extends RaphProperties> {
  name: RaphLocalPhaseName
  mode: RaphLocalPhaseMode
  always: boolean
  properties: Array<{
    name: keyof P
    propagation: RaphPropagation
    computeOn(node: RaphNode<P>): void
  }>
  beforeProcess?: RaphLocalNodeCallback<P>
  afterProcess?: RaphLocalNodeCallback<P>
}

/**
 * Описывает контракт RaphLocalPhaseContext.
 */
export interface RaphLocalPhaseContext<P extends RaphProperties> {
  phase: RaphLocalPhase<P>
  frame: RaphFrameContext
  root: RaphNode<P>
  dirty: RaphNode<P>[]
}

/**
 * Описывает контракт RaphLocalConfiguration.
 */
export interface RaphLocalConfiguration<P extends RaphProperties = RaphProperties> {
  app: RaphApp<P>
  props: Record<keyof P, unknown>
  phases: Record<string, RaphLocalPhase<P>>
}
