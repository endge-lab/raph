import type { RaphRuntime } from '@/domain/core/RaphRuntime'
import type { DataPathDef } from '@/domain/types/base.types'
import type { RaphMetaMutationEvent, RaphMetaWatchCallback, RaphMetaWatchOptions } from '@/domain/types/meta.types'
import type { PhaseExecutorContext, PhaseName } from '@/domain/types/phase.types'

import { RaphNode } from '@/domain/core/RaphNode'

/** Reactive callback-нода отдельного Meta-plane. */
export class RaphMetaWatch extends RaphNode {
  private readonly _disposers: Array<() => void> = []
  private readonly _events: RaphMetaMutationEvent[] = []

  public constructor(runtime: RaphRuntime<any>, id: string, masks: DataPathDef[], private readonly _callback: RaphMetaWatchCallback, options: RaphMetaWatchOptions) {
    super(runtime, { id, weight: options.weight ?? 0, type: 'meta-watch' })
    runtime.addNode(this)
    for (const mask of masks) {
      this._disposers.push(runtime.observeMeta(this, mask, {
        phase: '__watch' as PhaseName,
        namespace: options.namespace,
        vars: options.vars,
        wildcardDynamic: options.wildcardDynamic,
      }))
    }
  }

  public enqueue(event: RaphMetaMutationEvent): void {
    this._events.push(event)
  }

  public run(_context: PhaseExecutorContext): void {
    const events = this._events.splice(0)
    if (events.length) {
      this._callback({ events })
    }
  }

  public remove(): void {
    for (const dispose of this._disposers.splice(0)) {
      dispose()
    }
    this._events.length = 0
    this.app.removeNode(this)
  }
}
