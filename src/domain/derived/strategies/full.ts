import type { RaphDerivedFullStrategy } from '@/domain/types/derived.types'

/** Всегда полностью пересчитывает materialized target. */
export function full(): RaphDerivedFullStrategy {
  return Object.freeze({ kind: 'full' })
}
