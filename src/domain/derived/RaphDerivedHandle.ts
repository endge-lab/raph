import type { RaphDerivedManager } from '@/domain/derived/RaphDerivedManager'
import type { RaphDerivedNode } from '@/domain/derived/RaphDerivedNode'
import type {
  RaphDerivedDisposeTarget,
  RaphDerivedHandleContract,
  RaphDerivedHandleSnapshot,
  RaphDerivedStatus,
} from '@/domain/types/derived.types'
import { RaphDerivedDisposedError } from '@/domain/types/derived.types'

/** Публичный lifecycle handle системной derived-ноды. */
export class RaphDerivedHandle implements RaphDerivedHandleContract {
  private _manager: RaphDerivedManager | null

  public constructor(
    public readonly id: string,
    public readonly node: RaphDerivedNode,
    private readonly _internalId: string,
    private readonly _disposeTarget: RaphDerivedDisposeTarget,
    manager: RaphDerivedManager,
  ) {
    this._manager = manager
  }

  public pause(): void {
    this._requireManager().pause(this._internalId)
  }

  public resume(): void {
    this._requireManager().resume(this._internalId)
  }

  public recompute(): void {
    this._requireManager().recompute(this._internalId)
  }

  public dispose(): void {
    if (this.status === 'disposed') {
      return
    }
    this.node.dispose()
  }

  public snapshot(): RaphDerivedHandleSnapshot {
    return {
      ...this.node.snapshot(),
      disposeTarget: this._disposeTarget,
    }
  }

  public detachManager(): void {
    this._manager = null
  }

  public get status(): RaphDerivedStatus {
    return this.node.status
  }

  public get lastError(): Error | null {
    return this.node.lastError
  }

  private _requireManager(): RaphDerivedManager {
    if (!this._manager) {
      throw new RaphDerivedDisposedError(`[RaphDerived] Handle "${this.id}" is disposed.`)
    }
    return this._manager
  }
}
