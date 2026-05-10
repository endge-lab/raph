// Мин-куча для чисел с минимальными аллокациями (дружественна к сборщику мусора).
/**
 * Реализует минимальную heap-структуру для priority-based очередей.
 */
export class MinHeap {
  //
  private _a: Array<number>
  private _size: number

  //
  /**
   * Создает instance и подготавливает внутреннее состояние.
   */
  constructor(initialCapacity = 0) {
    // Вместимость сохраняется и используется повторно между кадрами
    this._a = initialCapacity > 0 ? new Array(initialCapacity) : []
    this._size = 0
  }

  /**
   * Вернуть текущее количество элементов в куче.
   */
  get size(): number {
    return this._size
  }

  /**
   * Проверить, пуста ли куча.
   */
  get empty(): boolean {
    return this._size === 0
  }

  /**
   * Очистить кучу, при необходимости сохранив выделенную память.
   */
  clear(preserveCapacity = true): void {
    if (preserveCapacity) this._size = 0
    else {
      this._a.length = 0
      this._size = 0
    }
  }

  /**
   * Зарезервировать ёмкость под указанное число элементов.
   */
  reserve(capacity: number): void {
    if (capacity > this._a.length) this._a.length = capacity
  }

  /**
   * Вернуть минимальный элемент без удаления.
   */
  peek(): number | undefined {
    return this._size === 0 ? undefined : this._a[0]
  }

  /**
   * Добавить один элемент в кучу.
   */
  push(x: number): void {
    const i = this._size
    if (i < this._a.length) this._a[i] = x
    else this._a.push(x)
    this._size = i + 1
    this._siftUp(i)
  }

  /**
   * Извлечь минимальный элемент из кучи.
   */
  pop(): number | undefined {
    const n = this._size
    if (n === 0) return undefined
    const a = this._a
    const min = a[0]
    const last = a[n - 1]
    this._size = n - 1
    if (this._size > 0) {
      a[0] = last
      this._siftDown(0)
    }
    return min
  }

  /**
   * Заменить верхний элемент и вернуть старый минимум.
   */
  replaceTop(x: number): number | undefined {
    if (this._size === 0) {
      this.push(x)
      return undefined
    }
    const min = this._a[0]
    this._a[0] = x
    this._siftDown(0)
    return min
  }

  /**
   * Построить кучу из массива чисел.
   */
  buildFrom(src: ReadonlyArray<number>): void {
    const n = src.length
    this._a.length = n
    for (let i = 0; i < n; i++) this._a[i] = src[i]
    this._size = n

    //
    // Построение кучи методом Флойда
    for (let i = (n >> 1) - 1; i >= 0; i--) this._siftDown(i)
  }

  /**
   * Поднять элемент вверх до корректной позиции.
   */
  private _siftUp(i: number): void {
    const a = this._a
    const x = a[i]
    while (i > 0) {
      const p = (i - 1) >> 1
      const y = a[p]
      if (x >= y) break
      a[i] = y
      i = p
    }
    a[i] = x
  }

  /**
   * Опустить элемент вниз до корректной позиции.
   */
  private _siftDown(i: number): void {
    const a = this._a
    const n = this._size
    const x = a[i]
    const half = n >> 1 // узлы с минимум 1 потомком
    while (i < half) {
      const l = (i << 1) + 1
      const r = l + 1
      let child = l
      let y = a[l]
      if (r < n) {
        const yr = a[r]
        if (yr < y) {
          child = r
          y = yr
        }
      }
      if (x <= y) break
      a[i] = y
      i = child
    }
    a[i] = x
  }
}
