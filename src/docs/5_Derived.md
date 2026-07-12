# Derived data

`derive` поддерживает синхронные materialized dependencies между ветками shared Raph store.

```ts
import { collectionByKey, Raph } from '@endge/raph'

const handle = Raph.derive({
  from: 'queries.schedule.raw',
  to: 'queries.schedule.table',
  strategy: collectionByKey('id'),
  compute: rows => rows.map(row => ({ id: row.id, title: row.name })),
})
```

Raph автоматически создает системную `RaphDerivedNode`. Она удаляется через `handle.dispose()` или вместе с runtime.

## Стратегии

`full()` полностью читает source, вызывает `compute(source)` и заменяет target при любом пересекающемся изменении.

`collectionByKey(key)` предназначен только для one-to-one row-local преобразований. В transaction Raph собирает измененные ключи, читает полные source items, один раз вызывает `compute(affectedItems)` и заменяет соответствующие target items.

Root replacement, reorder, numeric index mutation, key mutation и неизвестная форма path используют full fallback.

## Transaction

```ts
Raph.transaction(() => {
  Raph.set('queries.schedule.raw[id=1].name', 'A')
  Raph.merge('queries.schedule.raw[id=2]', { name: 'B' })
  Raph.delete('queries.schedule.raw[id=3]')
})
```

Derived graph стабилизируется до передачи source и target events обычным observers. Повторные изменения одного ключа вычисляются один раз.

## Ограничения

- `compute` должен быть синхронным и чистым.
- Promise и reentrant store mutations внутри `compute` запрещены.
- `from` и `to` должны быть concrete paths без wildcard и dynamic variables.
- Active target является read-only и имеет только одного writer.
- `collectionByKey` поддерживает ключи `string | number`, сохраняет cardinality и порядок.
- При compute error source сохраняется, а target остается в last-good состоянии.

## Lifecycle

```ts
handle.pause()
handle.resume()     // full recompute
handle.recompute()  // принудительный full recompute
handle.dispose()
```

Target сохраняется по умолчанию. Для scoped данных можно указать `disposeTarget: 'delete'`.

## Проверка

```bash
pnpm test:derived
pnpm test:derived:memory
pnpm bench:derived
pnpm bench:derived:stress
```
