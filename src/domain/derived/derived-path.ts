import type { DataPathDef } from '@/domain/types/base.types'
import type { RaphDerivedKey, RaphDerivedMutationRecord } from '@/domain/types/derived.types'
import type { DataPathSegment } from '@/domain/types/path.types'
import { DataPath } from '@/domain/entities/DataPath'
import { RaphDerivedPathError } from '@/domain/types/derived.types'
import { SegKind } from '@/domain/types/path.types'

/** Возвращает concrete canonical path и отклоняет dynamic/wildcard definitions. */
export function canonicalDerivedPath(input: DataPathDef, label: 'from' | 'to'): DataPath {
  const path = DataPath.from(input)
  const segments = path.segments()
  if (!segments.length) {
    throw new RaphDerivedPathError(`[RaphDerived] ${label} path must not be empty.`)
  }

  for (const segment of segments) {
    if (segment.kind === SegKind.Wildcard) {
      throw new RaphDerivedPathError(`[RaphDerived] ${label} path must be concrete and cannot contain wildcards.`)
    }
    if (segment.kind === SegKind.Key && String(segment.key ?? '').startsWith('$')) {
      throw new RaphDerivedPathError(`[RaphDerived] ${label} path contains an unresolved dynamic key.`)
    }
    if (segment.kind === SegKind.Param && String(segment.pval ?? '').startsWith('$')) {
      throw new RaphDerivedPathError(`[RaphDerived] ${label} path contains an unresolved dynamic parameter.`)
    }
  }
  return path
}

/** Проверяет пересечение concrete paths по отношению ancestor/descendant. */
export function pathsOverlap(left: DataPath, right: DataPath): boolean {
  const a = left.segments()
  const b = right.segments()
  const length = Math.min(a.length, b.length)
  for (let index = 0; index < length; index++) {
    if (!segmentsEqual(a[index], b[index])) {
      return false
    }
  }
  return true
}

/** Строит deep route, совпадающий с самим path и всеми descendants. */
export function derivedRoute(path: DataPath): string {
  return `${path.toStringPath()}.*`
}

export type CollectionMutationImpact = { kind: 'full' } | { kind: 'key', key: RaphDerivedKey }

/** Определяет, допускает ли mutation точечный пересчет collectionByKey. */
export function collectionMutationImpact(
  source: DataPath,
  keyField: string,
  mutation: RaphDerivedMutationRecord,
): CollectionMutationImpact {
  const sourceSegments = source.segments()
  const mutationSegments = mutation.path.segments()

  if (mutationSegments.length <= sourceSegments.length) {
    return { kind: 'full' }
  }
  for (let index = 0; index < sourceSegments.length; index++) {
    if (!segmentsEqual(sourceSegments[index], mutationSegments[index])) {
      return { kind: 'full' }
    }
  }

  const itemSegment = mutationSegments[sourceSegments.length]
  if (itemSegment?.kind !== SegKind.Param || itemSegment.pkey !== keyField) {
    return { kind: 'full' }
  }
  if (typeof itemSegment.pval !== 'string' && typeof itemSegment.pval !== 'number') {
    return { kind: 'full' }
  }

  const itemField = mutationSegments[sourceSegments.length + 1]
  if (itemField?.kind === SegKind.Key && itemField.key === keyField) {
    return { kind: 'full' }
  }

  return { kind: 'key', key: itemSegment.pval }
}

/** Добавляет параметризованный selector к collection path. */
export function keyedPath(collection: DataPath, keyField: string, key: RaphDerivedKey): string {
  const rendered = typeof key === 'number' ? String(key) : JSON.stringify(key)
  return `${collection.toStringPath()}[${keyField}=${rendered}]`
}

function segmentsEqual(left: DataPathSegment | undefined, right: DataPathSegment | undefined): boolean {
  if (!left || !right || left.kind !== right.kind) {
    return false
  }
  if (left.kind === SegKind.Key) {
    return left.key === right.key
  }
  if (left.kind === SegKind.Index) {
    return left.index === right.index
  }
  if (left.kind === SegKind.Param) {
    return left.pkey === right.pkey && left.pval === right.pval
  }
  return true
}
