import type { RaphApp } from '@/domain/core/RaphApp'
import type { RaphNode } from '@/domain/core/RaphNode'
import type { RaphFrameContext, RaphProperties } from '@/domain/types/base.types'

export type RaphLocalPhaseName = string

export enum RaphPropagation {
  None = 'none',
  Down = 'down',
  Up = 'up',
}

export type RaphLocalPhaseMode = 'dirty' | 'all'

export type RaphLocalPhaseRunner<P extends RaphProperties> = (
  payload: RaphLocalPhaseContext<P>,
) => void

export type RaphLocalNodeCallback<P extends RaphProperties> = (
  node: RaphNode<P>,
  phase: RaphLocalPhase<P>,
) => void

export type RaphLocalPropertyCompute<P extends RaphProperties, K extends keyof P> = (
  node: RaphNode<P>,
) => P[K]

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

export interface RaphLocalPhaseDescriptor<P extends RaphProperties> {
  name: RaphLocalPhaseName
  process?: RaphLocalPhaseRunner<P>
  beforeProcess?: RaphLocalNodeCallback<P>
  afterProcess?: RaphLocalNodeCallback<P>
  always?: boolean
  mode?: RaphLocalPhaseMode
  priority?: number
}

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

export interface RaphLocalPhaseContext<P extends RaphProperties> {
  phase: RaphLocalPhase<P>
  frame: RaphFrameContext
  root: RaphNode<P>
  dirty: RaphNode<P>[]
}

export interface RaphLocalConfiguration<P extends RaphProperties = RaphProperties> {
  app: RaphApp<P>
  props: Record<keyof P, unknown>
  phases: Record<string, RaphLocalPhase<P>>
}
