import type { RaphNode } from '@/domain/core/RaphNode'
import type { DepGraph } from '@/domain/entities/DepGraph'
import type {
  PhaseEvent,
  PhaseName,
  RaphPhase,
} from '@/domain/types/phase.types'

/**
 * Описывает контракт RaphEventPayloads.
 */
export interface RaphEventPayloads {
  //
  'node:tracked': { node: RaphNode, path: string }
  'node:untracked': { node: RaphNode, path?: string }
  'node:notified': { node: RaphNode, event: PhaseEvent }

  //
  'nodes:changed': { graph: DepGraph }
  'nodes:notified': {
    ctxs: Array<{
      phase: PhaseName
      node: RaphNode
      events?: Array<PhaseEvent>
    }>
  }

  //
  'phases:reinit': { phases: Array<RaphPhase> }

  //
  'debug:nodes': Record<string, never>
  'debug:metrics': Record<string, never>
}
