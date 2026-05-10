import type { RaphEventPayloads } from '@/domain/types/events.types'
import { EventBus } from '@/utils/EventBus'
import { RaphDebug } from '@/domain/core/RaphDebug'

/**
 * Shared Raph runtime constants and singleton diagnostics.
 */
export const RAPH_MAX_UPS = 144
export const RAPH_WEIGHT_LIMIT = 100
export const RAPH_MAX_DEPTH = 5
export const RAPH_EVENTS = new EventBus<RaphEventPayloads>()
export const RAPH_DEBUG = new RaphDebug()
