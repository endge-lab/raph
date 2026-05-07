# Raph Local / Instant

## Идея

`@endge/raph` теперь содержит два совместимых слоя в одном `RaphApp`:

- data-path слой: `get`, `set`, `merge`, `delete`, `track`, `subscribe`;
- local/instant слой: свойства нод, dirty-фазы, propagation по дереву и hooks.

Local-слой не проходит через `DataPath`. Он нужен для быстрых runtime-свойств конкретных нод: видимость, позиция, layout-флаги, render-state, интерактивные состояния. Глобальные данные приложения при этом могут жить в том же `RaphApp`, если сценарию нужен единый store и единые события.

## Философия

`Raph` не является графическим API. Он одинаково подходит для DOM, Canvas, data-flow и смешанных приложений. Nova использует local-слой для canvas-ноды, но в ядре нет терминов `scene`, `surface` или `render`.

Если приложение содержит несколько независимых canvas или DOM-областей, можно выбрать один из двух подходов:

- один `RaphApp` с общим data-store и несколькими локальными деревьями нод;
- несколько `RaphApp` для разных execution/scheduler контуров и явный bridge на уровне приложения.

Общий `RaphApp` удобен, когда данные и события должны быть едиными. Несколько инстансов лучше, когда разные части имеют разные scheduler-режимы, жизненный цикл или должны изолировать тяжелые dirty-очереди друг от друга.

## Минимальный пример

```ts
import {
  Raph,
  RaphLocalPhase,
  RaphLocalProperty,
  RaphNode,
  RaphPropagation,
} from '@endge/raph'

type Props = {
  visible: boolean
  x: number
}

class App {
  @RaphLocalPhase({ name: 'layout' })
  layout(payload) {
    Raph.processDirtyNodes({ payload })
  }

  @RaphLocalPhase({ name: 'render', always: true })
  render(payload) {
    Raph.processDirtyNodes({ payload })
  }
}

class Node extends RaphNode<Props> {
  @RaphLocalProperty({
    phase: 'layout',
    default: true,
    propagation: RaphPropagation.Down,
  })
  visible!: boolean

  @RaphLocalProperty({
    phase: 'render',
    default: 0,
  })
  x!: number
}

const { app } = Raph.configureLocal<Props, App, Node>(
  () => new App(),
  () => new Node(),
)

const root = new Node(app, { id: 'root' })
const child = new Node(app, { id: 'child' })

root.addChild(child)
child.local.set('x', 10)

app.run()
```

## Local API ноды

```ts
node.local.get('x')
node.local.set('x', 10)
node.get('x')
node.set('x', 10)
node.options({ weight: 10 })
node.dirty('render')
node.parent
node.children
```

`node.local.set` помечает только нужную фазу и складывает событие в dirty queue. Несколько записей в одну и ту же `node+phase` до `run()` дедуплицируются, а reasons/events копятся в payload.

## Propagation

`RaphPropagation.None` помечает только текущую ноду.

`RaphPropagation.Down` проходит по потомкам текущей ноды без полного обхода всех нод приложения. Это используется для inherited-флагов вроде `visible`.

`RaphPropagation.Up` проходит по родителям текущей ноды и подходит для агрегатов, где изменение потомка должно поднять dirty-состояние наверх.

## Ordering

Для Nova/timeline `Raph.configureLocal` включает legacy-compatible ordering: сначала меньшая глубина, затем меньший `weight`. Это сохраняет порядок update/render, который использовался в старом instant-движке.

Data-path ordering в `@endge/raph` не меняется. Если потребуется другой порядок исполнения для data-flow, его нужно задавать отдельной priority strategy, не смешивая с local-совместимостью Nova.

## Scheduler

Local dirty queue работает с тем же scheduler, что и `RaphApp`: sync, microtask или animation-frame. Если разные части приложения должны тикать в разных режимах, лучше использовать разные `RaphApp`. Если нужен общий store, его можно держать выше уровня конкретных execution-инстансов и синхронизировать явно через subscribe/bridge.
