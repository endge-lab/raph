import { describe, expect, it } from 'vitest'
import {
  canonicalDerivedPath,
  collectionMutationImpact,
  keyedPath,
  pathsOverlap,
} from '@/domain/derived/derived-path'
import { collectionByKey } from '@/domain/derived/strategies/collection-by-key'
import { DataPath } from '@/domain/entities/DataPath'
import { RaphDerivedPathError, RaphDerivedStrategyError } from '@/domain/types/derived.types'

describe('семантика путей производных данных Raph', () => {
  it('проверяет конкретные пути и все варианты пересечения сегментов', () => {
    expect(() => canonicalDerivedPath('', 'from')).toThrow(RaphDerivedPathError)
    expect(() => canonicalDerivedPath('rows.*', 'from')).toThrow(RaphDerivedPathError)
    expect(() => canonicalDerivedPath('rows[id=$id]', 'from')).toThrow(RaphDerivedPathError)
    expect(() => canonicalDerivedPath('$branch.value', 'to')).toThrow(RaphDerivedPathError)
    expect(() => canonicalDerivedPath({ segs: [{ t: 'key', k: '$branch' }] }, 'from')).toThrow(RaphDerivedPathError)
    expect(() => canonicalDerivedPath({ segs: [{ t: 'key', k: 'rows' }, { t: 'param', pk: 'id', pv: '$id' }] }, 'to')).toThrow(RaphDerivedPathError)

    expect(pathsOverlap(DataPath.from('rows[0].value'), DataPath.from('rows[0]'))).toBe(true)
    expect(pathsOverlap(DataPath.from('rows[0]'), DataPath.from('rows[1]'))).toBe(false)
    expect(pathsOverlap(DataPath.from('rows[id=1]'), DataPath.from('rows[id=2]'))).toBe(false)
    expect(pathsOverlap(DataPath.from('rows[id=1]'), DataPath.from('rows[id=1].value'))).toBe(true)
    expect(pathsOverlap(DataPath.from('rows.*'), DataPath.from('rows.*'))).toBe(true)
  })

  it('классифицирует изменения коллекции и формирует строковые и числовые selectors', () => {
    const source = DataPath.from('rows')
    const record = (path: string) => ({
      kind: 'set' as const,
      path: DataPath.from(path),
      originalPath: path,
    })
    expect(collectionMutationImpact(source, 'id', record('rows'))).toEqual({ kind: 'full' })
    expect(collectionMutationImpact(source, 'id', record('other[id=1]'))).toEqual({ kind: 'full' })
    expect(collectionMutationImpact(source, 'id', record('rows[0].value'))).toEqual({ kind: 'full' })
    expect(collectionMutationImpact(source, 'id', record('rows[code=1].value'))).toEqual({ kind: 'full' })
    expect(collectionMutationImpact(source, 'id', {
      kind: 'set',
      path: DataPath.from({ segs: [{ t: 'key', k: 'rows' }, { t: 'param', pk: 'id', pv: true }] }),
      originalPath: 'rows[id=true]',
    })).toEqual({ kind: 'full' })
    expect(collectionMutationImpact(source, 'id', record('rows[id=1].id'))).toEqual({ kind: 'full' })
    expect(collectionMutationImpact(source, 'id', record('rows[id=1].value'))).toEqual({ kind: 'key', key: 1 })
    expect(keyedPath(source, 'id', 1)).toBe('rows[id=1]')
    expect(keyedPath(source, 'id', 'a')).toBe('rows[id="a"]')
    const escaped = keyedPath(source, 'id', 'SU "101"')
    expect(DataPath.from(escaped).segments()[1].pval).toBe('SU "101"')
  })

  it('отклоняет пустой ключ коллекции', () => {
    expect(() => collectionByKey('  ')).toThrow(RaphDerivedStrategyError)
    expect(() => collectionByKey(null as any)).toThrow(RaphDerivedStrategyError)
  })
})
