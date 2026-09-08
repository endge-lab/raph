/** A transient copy-on-write graph. Reads and writes never change the source graph. */
export function createDataDraft<T extends object>(root: T, onArrayChange: (array: any[]) => void) {
  interface State {
    source: any
    proxy: any
    values: Map<PropertyKey, unknown>
    removed: Set<PropertyKey>
    changed: Set<PropertyKey>
    parents: Map<State, Set<PropertyKey>>
  }
  const states = new WeakMap<object, State>()
  const proxies = new WeakMap<object, State>()

  const mark = (state: State, key: PropertyKey, visited = new Set<State>()) => {
    if (visited.has(state)) {
      return
    }
    visited.add(state)
    state.changed.add(key)
    if (Array.isArray(state.source)) {
      onArrayChange(state.proxy)
    }
    for (const [parent, keys] of state.parents) {
      for (const parentKey of keys) {
        mark(parent, parentKey, visited)
      }
    }
  }

  const wrap = (value: any, parent?: State, key?: PropertyKey): any => {
    if (!value || typeof value !== 'object') {
      return value
    }
    const proto = Object.getPrototypeOf(value)
    let state = proxies.get(value) ?? states.get(value)
    if (!state) {
      const source = value
      const array = Array.isArray(source)
      const target = array ? [] : Object.create(proto)
      if (array) {
        target.length = source.length
      }
      state = { source, proxy: null, values: new Map(), removed: new Set(), changed: new Set(), parents: new Map() }
      const current = state
      const has = (property: PropertyKey) => !current.removed.has(property)
        && (current.values.has(property) || Reflect.has(source, property))
      const read = (property: PropertyKey) => current.removed.has(property)
        ? undefined
        : current.values.has(property) ? current.values.get(property) : Reflect.get(source, property)
      current.proxy = new Proxy(target, {
        get: (_, property) => wrap(read(property), current, property),
        has: (_, property) => has(property),
        set: (_, property, next) => {
          if (array && property === 'length') {
            const length = Number(next)
            if (!Number.isInteger(length) || length < 0 || length > 0xFFFFFFFF) {
              throw new RangeError('Invalid array length')
            }
            for (let index = length; index < Number(read('length')); index++) {
              current.removed.add(String(index))
              current.values.delete(String(index))
            }
            target.length = length
          }
          else if (array && typeof property === 'string' && /^(?:0|[1-9]\d*)$/.test(property)) {
            const index = Number(property)
            if (index < 0xFFFFFFFF && index >= Number(read('length'))) {
              current.values.set('length', index + 1)
              target.length = index + 1
            }
          }
          current.values.set(property, next)
          current.removed.delete(property)
          mark(current, property)
          return true
        },
        deleteProperty: (_, property) => {
          if (array && property === 'length') {
            return false
          }
          current.values.delete(property)
          current.removed.add(property)
          mark(current, property)
          return true
        },
        ownKeys: () => [...new Set([...Reflect.ownKeys(source), ...current.values.keys()])]
          .filter(property => !current.removed.has(property)) as (string | symbol)[],
        getOwnPropertyDescriptor: (_, property) => {
          if (array && property === 'length') {
            return { value: read(property), writable: true, enumerable: false, configurable: false }
          }
          const descriptor = Object.getOwnPropertyDescriptor(source, property)
          if (current.removed.has(property) || (!descriptor && !current.values.has(property))) {
            return undefined
          }
          return { value: wrap(read(property), current, property), writable: true, enumerable: descriptor?.enumerable ?? true, configurable: true }
        },
      })
      states.set(source, current)
      proxies.set(current.proxy, current)
    }
    if (parent && key !== undefined) {
      let keys = state.parents.get(parent)
      if (!keys) {
        keys = new Set()
        state.parents.set(parent, keys)
      }
      keys.add(key)
    }
    return state.proxy
  }

  return {
    root: wrap(root) as T,
    unchangedArray(array: any[], key: string): any[] | null {
      const state = proxies.get(array)
      if (!state) {
        return null
      }
      // Only changed rows are inspected; an ordinary field update reuses source indexes.
      for (const property of state.changed) {
        if (state.values.has(property) || state.removed.has(property)) {
          return null
        }
        const row = states.get(state.source[property])
        if (row?.changed.has(key)) {
          return null
        }
      }
      return state.source
    },
  }
}
