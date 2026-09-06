# Meta-plane

Raph Meta — отдельный реактивный слой произвольной пользовательской metadata,
привязанный к существующим `DataPath`. Он не входит в `Raph.data`, snapshots и
derived graph и не вводит доменные статусы вроде `waiting` или `confirmed`.

```ts
Raph.set('rows[id=42].carrier', 'SU')

Raph.meta.set('rows[id=42].carrier', 'aodb.optimistic', {
  status: 'waiting',
  optimisticValue: 'SU',
})

Raph.meta.merge('rows[id=42].carrier', 'aodb.optimistic', {
  attempts: 1,
})

Raph.meta.get('rows[id=42].carrier', 'aodb.optimistic')
Raph.meta.has('rows[id=42].carrier', 'aodb.optimistic')
Raph.meta.delete('rows[id=42].carrier', 'aodb.optimistic')
```

Без namespace `get` возвращает объект всех namespaces exact path, а `delete`
удаляет их на этом path. Namespace обязателен для `set` и `merge`.

Meta можно записать только для существующего owner data path. Значение
`undefined` считается существующим, поэтому для проверки используется
`Raph.has()`. Удаление data leaf или parent каскадно удаляет связанную Meta;
структурная замена parent очищает только исчезнувших descendants.

```ts
const stop = Raph.meta.watch(
  'rows[*].carrier',
  ({ events }) => console.log(events),
  { namespace: 'aodb.optimistic' },
)
```

Data и Meta используют одну delivery transaction. После стабилизации derived
graph runtime получает финальное состояние обоих слоёв и инвалидируется один
раз. Transaction не выполняет rollback.

Meta адресуется путём, а не JS-объектом. Для коллекций используйте identity
selector `rows[id=$id]`; позиционный `rows[3]` остаётся metadata позиции.
