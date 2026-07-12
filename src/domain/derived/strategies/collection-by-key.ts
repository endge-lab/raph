import type { RaphDerivedCollectionByKeyStrategy } from '@/domain/types/derived.types'
import { RaphDerivedStrategyError } from '@/domain/types/derived.types'

/** Создает one-to-one incremental strategy для коллекций со стабильным ключом. */
export function collectionByKey(key: string): RaphDerivedCollectionByKeyStrategy {
  const normalized = String(key ?? '').trim()
  if (!normalized)
    throw new RaphDerivedStrategyError('[RaphDerived] collectionByKey requires a non-empty key.')
  return Object.freeze({ kind: 'collection-by-key', key: normalized })
}
