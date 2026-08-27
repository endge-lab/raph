import type { RaphDerivedFilterByKeyStrategy } from '@/domain/types/derived.types'
import { RaphDerivedStrategyError } from '@/domain/types/derived.types'

/** Создает zero-or-one incremental strategy для row-local фильтрации коллекции. */
export function filterByKey(key: string): RaphDerivedFilterByKeyStrategy {
  const normalized = String(key ?? '').trim()
  if (!normalized) {
    throw new RaphDerivedStrategyError('[RaphDerived] filterByKey requires a non-empty key.')
  }
  return Object.freeze({ kind: 'filter-by-key', key: normalized })
}
