# @endge/raph

Reactive application pipeline, graph scheduler, and path router for complex state flows.

`@endge/raph` is a low-level runtime for applications where updates are driven by:

- a dependency graph of nodes
- path-based subscriptions like `orders[id=10].items[*].price`
- explicit execution phases
- configurable schedulers (`sync`, `microtask`, `animationFrame`)

It can be used as:

- a small reactive runtime through the static `Raph` API
- a lower-level engine through `RaphApp`, `RaphNode`, `RaphRouter`, and `DataPath`

## Status

This package is usable, but the API should still be treated as experimental.

## Installation

```bash
npm install @endge/raph
```

## Quick Start

### Signals, effects, and watchers

```ts
import { Raph } from '@endge/raph'

const count = Raph.signal(0)
const doubled = Raph.signal(() => count.value * 2)

const stopEffect = Raph.effect(() => {
  console.log('count =', count.value, 'doubled =', doubled.value)
})

const stopWatch = Raph.watch('user.*', ({ events }) => {
  console.log('user changed', events)
})

count.value = 1
Raph.set('user.name', 'Ada')

stopWatch()
stopEffect()
```

### Explicit app and phases

```ts
import {
  RaphApp,
  RaphNode,
  SchedulerType,
  type PhaseName,
  type PhaseExecutorContext,
} from '@endge/raph'

const app = new RaphApp()

app.options({
  scheduler: SchedulerType.Sync,
})

app.definePhases([
  {
    name: 'render' as PhaseName,
    traversal: 'dirty-and-down',
    routes: ['ui.*'],
    each: (ctx: PhaseExecutorContext) => {
      console.log('render node', ctx.node.id, ctx.events)
    },
  },
])

const node = new RaphNode(app, { id: 'screen' })
app.addNode(node)
app.track(node, 'ui.dashboard.*')

app.set('ui.dashboard.title', 'Overview')
```

## Core Concepts

### 1. Data paths

Raph addresses data by structured paths.

Examples:

- `user.name`
- `rows[0].status`
- `orders[id=10].total`
- `orders[id=$orderId].items[id=$itemId].price`
- `scene.layers[*].visible`
- `user.*`

Supported path rules:

- `foo.bar` for object access
- `[3]` for array index access
- `[id=10]` for array item lookup by field
- `[*]` for array wildcard
- `*` in the middle for a single-segment wildcard
- trailing `*` for deep wildcard matching
- `$vars` interpolation through `vars`

### 2. Nodes

`RaphNode` is the runtime unit that participates in the dependency graph.

A node can:

- be registered in the app graph
- depend on another node
- subscribe to one or more data masks
- be scheduled for execution in one or more phases

### 3. Phases

A phase is an execution step with:

- `name`
- `traversal`
- `routes`
- `each(ctx)` or `all(ctxs)`

Available traversal modes:

- `dirty-only`
- `dirty-and-down`
- `dirty-and-up`
- `all`

### 4. Scheduler

`RaphApp` can run in different scheduling modes:

- `SchedulerType.Sync`
- `SchedulerType.Microtask`
- `SchedulerType.AnimationFrame`

Example:

```ts
import { Raph, SchedulerType } from '@endge/raph'

Raph.options({
  scheduler: SchedulerType.Microtask,
  maxUps: 120,
})
```

## Main API

### Static API: `Raph`

Use `Raph` when one shared default app is enough.

Main methods:

- `Raph.options(opts)`
- `Raph.definePhases(phases)`
- `Raph.addPhase(phase)`
- `Raph.clearPhases()`
- `Raph.signal(initialOrCompute)`
- `Raph.effect(fn, opts?)`
- `Raph.watch(maskOrMasks, cb, opts?)`
- `Raph.get(path, opts?)`
- `Raph.set(path, value, opts?)`
- `Raph.merge(path, value, opts?)`
- `Raph.delete(path, opts?)`
- `Raph.createNode(opts?)`
- `Raph.track(node, mask, opts?)`
- `Raph.subscribe(node, maskOrMasks, callback, opts?)`
- `Raph.unsubscribeOwner(node)`

Useful getters:

- `Raph.app`
- `Raph.data`
- `Raph.events`
- `Raph.debug`

### Low-level API: `RaphApp`

Use `RaphApp` when you need isolated runtimes or explicit orchestration.

Common operations:

- configure scheduler and adapter via `app.options(...)`
- register phases with `app.definePhases(...)`
- register graph nodes with `app.addNode(node)`
- wire dependencies with `app.addDependency(parent, child)`
- subscribe nodes with `app.track(node, mask)`
- mutate data with `app.set / app.merge / app.delete`

## DataPath

`DataPath` is the path parser and serializer used by the rest of the runtime.

```ts
import { DataPath } from '@endge/raph'

const path = DataPath.fromString('orders[id=$oid].items[id=$iid].price', {
  vars: { oid: 10, iid: 5 },
})

console.log(path.toStringPath())
```

Use `wildcardDynamic: true` when unresolved variables should degrade into wildcards.

```ts
const path = DataPath.fromString('orders[id=$oid].items[*].price', {
  vars: {},
  wildcardDynamic: true,
})
```

## Router

`RaphRouter` is a generic router for matching data paths against payloads.

```ts
import { RaphRouter } from '@endge/raph'

const router = new RaphRouter<string>()

router.add('orders[id=$oid].items[id=$iid].price', 'PriceWatch')
router.add('orders.*', 'OrdersChanged')

const exact = router.match('orders[id=10].items[id=5].price')
const detailed = router.matchWithParams('orders[id=10].items[id=5].price')

console.log(exact)
console.log(detailed)
```

Useful methods:

- `add(mask, payload)`
- `remove(mask, payload?)`
- `removePayload(payload)`
- `removeAll()`
- `match(path)`
- `matchWithParams(path)`
- `matchIncludingPrefixWithParams(path)`

## Custom Data Adapter

`RaphApp` uses an in-memory adapter by default, but you can provide your own `DataAdapter`.

```ts
import { RaphApp, type DataAdapter } from '@endge/raph'

const adapter: DataAdapter = {
  root: () => ({}),
  get: () => undefined,
  set: () => {},
  delete: () => {},
  merge: () => {},
  indexOf: () => -1,
}

const app = new RaphApp()
app.options({ adapter })
```

## Package Exports

The package exports:

- `Raph`
- `RaphApp`
- `RaphNode`
- `RaphRouter`
- `RaphRouterNode`
- `DataPath`
- `DefaultDataAdapter`
- `DepGraph`
- `ControlFlowRegistry`
- `ControlFlowQueue`
- `RaphSignal`
- `RaphEffect`
- `RaphWatch`
- public runtime types

## Notes

- This package is intentionally low-level.
- It is a better fit for runtime engines, editors, graph-driven UIs, and custom reactive systems than for simple state management.
- Public behavior is path-centric and phase-centric by design.

## License

Apache-2.0
