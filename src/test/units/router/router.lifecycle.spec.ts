import { describe, expect, it } from 'vitest'
import { RaphRouter } from '@/domain/core/RaphRouter'
import { DataPath } from '@/domain/entities/DataPath'

function rootOf(router: RaphRouter<unknown>) {
  return (router as unknown as { _root: Record<string, unknown> })._root
}

describe('жизненный цикл RaphRouter', () => {
  it.each([
    ['exact', 'orders.rows.name', 'orders.rows.name'],
    ['wildcard', 'orders.*.name', 'orders.any.name'],
    ['deep wildcard', 'orders.*', 'orders.any.deep'],
    ['literal param', 'orders[id=7].name', 'orders[id=7].name'],
    ['captured param', 'orders[id=$id].name', 'orders[id=8].name'],
  ])('удаляет изолированную ветвь %s и разрешает её повторное построение', (_kind, mask, path) => {
    const router = new RaphRouter<object>()
    const payload = {}
    router.add(mask, payload)
    expect(router.match(path)).toContain(payload)

    router.remove(mask, payload)
    expect(router.match(path)).not.toContain(payload)
    expect(rootOf(router)).toMatchObject({
      exact: null,
      wc: null,
      param: null,
      paramAny: null,
      end: null,
      deep: null,
    })

    router.add(mask, payload)
    expect(router.match(path)).toContain(payload)
  })

  it('сохраняет соседние ветви trie при частичном и полном untrack', () => {
    const router = new RaphRouter<object>()
    const first = {}
    const second = {}
    router.add('orders.active.name', first)
    router.add('orders.archived.name', first)
    router.add('orders.active.total', second)

    router.remove('orders.active.name', first)
    expect(router.match('orders.active.name')).toEqual(new Set())
    expect(router.match('orders.archived.name')).toEqual(new Set([first]))
    expect(router.match('orders.active.total')).toEqual(new Set([second]))

    router.removePayload(first)
    expect(router.match('orders.archived.name')).toEqual(new Set())
    expect(router.match('orders.active.total')).toEqual(new Set([second]))
  })

  it('идемпотентно обрабатывает повторные track и untrack', () => {
    const router = new RaphRouter<object>()
    const payload = {}
    router.add('rows.current', payload)
    router.add('rows.current', payload)
    expect(router.match('rows.current')).toEqual(new Set([payload]))

    router.remove('rows.current', payload)
    router.remove('rows.current', payload)
    router.removePayload(payload)
    expect(router.match('rows.current')).toEqual(new Set())
  })

  it('сразу инвалидирует caches match и prefix при удалении', () => {
    const router = new RaphRouter<object>()
    const payload = {}
    router.add('rows.current.value', payload)
    expect(router.match('rows.current.value')).toContain(payload)
    expect(router.collectByPrefix('rows')).toContain(payload)

    router.removePayload(payload)

    const internals = router as unknown as {
      _matchCache: Map<string, unknown>
      _prefixCache: Map<string, unknown>
      _payloadMasks: Map<object, Set<string>>
    }
    expect(internals._matchCache.size).toBe(0)
    expect(internals._prefixCache.size).toBe(0)
    expect(internals._payloadMasks.size).toBe(0)
    expect(router.match('rows.current.value')).toEqual(new Set())
  })

  it('удаляет каждый индекс payload при очистке маски без payload', () => {
    const router = new RaphRouter<object>()
    const first = {}
    const second = {}
    router.add('rows.current', first)
    router.add('rows.current', second)
    router.remove('rows.current')

    const index = (router as unknown as { _payloadMasks: Map<object, Set<string>> })._payloadMasks
    expect(index.size).toBe(0)
    expect(router.match('rows.current')).toEqual(new Set())
  })

  it('ограничивает глобальные строковые caches DataPath для уникальных runtime-путей', () => {
    DataPath._cacheFromString.clear()
    DataPath._cacheSegments.clear()
    for (let index = 0; index < 20_500; index++) {
      DataPath.from(`runtime.unique${index}.value`)
    }

    expect(DataPath._cacheFromString.size).toBeLessThanOrEqual(20_000)
    expect(DataPath._cacheSegments.size).toBeLessThanOrEqual(20_000)
  })
})
