import type { RaphRuntime } from '@/domain/core/RaphRuntime'
import type { DataPathDef } from '@/domain/types/base.types'
import type { PhaseExecutorContext } from '@/domain/types/phase.types'
import type { WatchCallback } from '@/domain/types/reactive.types'
//
//
import { RaphNode } from '@/domain/core/RaphNode'

/**
 * Описывает reactive watcher для наблюдения за computed value.
 */
export class RaphWatch extends RaphNode {
  private readonly _cb: WatchCallback

  /**
   * Создать watch-ноду и подписать её на набор масок.
   */
  constructor(
    app: RaphRuntime,
    id: string,
    masks: Array<DataPathDef> | ReadonlyArray<DataPathDef>,
    cb: WatchCallback,
    weight = 0,
  ) {
    super(app, { id, weight, type: 'watch' })
    this._cb = cb

    //
    // регистрируемся в графе и роутере путей:
    app.addNode(this)

    //
    // Подписываемся на все пути
    if (!Array.isArray(masks)) {
      masks = [masks]
    }
    for (const m of masks) {
      app.track(this, m)
    }
  }

  /**
   * Выполнить callback watch с батчем событий текущей фазы.
   */
  run(ctx: PhaseExecutorContext): void {
    this._cb({ events: ctx.events || [] })
  }

  /**
   * Снимает все подписки и удаляет узел
   */
  remove(): void {
    //
    // снять все маски
    this.app.untrack(this)

    //
    // убрать из графа
    this.app.removeNode(this)
  }
}
