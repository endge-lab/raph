import type { RaphRuntime } from '@/domain/core/RaphRuntime'
import type {
  RaphDerivedNodeSnapshot,
  RaphDerivedStatus,
  RaphDerivedStrategy,
} from '@/domain/types/derived.types'
import { RaphNode } from '@/domain/core/RaphNode'

/** Системная runtime-нода materialized dependency. */
export class RaphDerivedNode extends RaphNode {
  private _status: RaphDerivedStatus = 'active'
  private _lastError: Error | null = null
  private _stale = false
  private _computeCount = 0
  private _fullComputeCount = 0
  private _incrementalComputeCount = 0
  private _targetWriteCount = 0
  private _disposed = false
  private _onDispose: (() => void) | null = null

  public constructor(
    runtime: RaphRuntime,
    id: string,
    private readonly _publicId: string,
    private readonly _from: string,
    private readonly _to: string,
    private readonly _strategy: RaphDerivedStrategy,
  ) {
    super(runtime, {
      id,
      type: 'derived',
      meta: {
        type: 'derived',
        derivedId: _publicId,
        from: _from,
        to: _to,
        strategy: _strategy.kind,
      },
    })
  }

  /** Привязывает unregister callback после успешной регистрации manager. */
  public bindDispose(callback: () => void): void {
    this._onDispose = callback
  }

  /** Освобождает manager registration и удаляет системную ноду. */
  public override dispose(): void {
    if (this._disposed) {
      return
    }
    this._disposed = true
    try {
      this._onDispose?.()
    }
    finally {
      this._onDispose = null
      // RaphNode.dispose() сам по себе не вырезает прямой вызов из parent.children.
      // Для system node сначала используем remove(), чтобы root не удерживал
      // disposed handle/node сильной ссылкой.
      if (this.parent) {
        this.remove()
      }
      super.dispose()
    }
  }

  public markPaused(): void {
    this._status = 'paused'
  }

  public markActive(): void {
    this._status = 'active'
    this._lastError = null
    this._stale = false
  }

  public markError(error: Error): void {
    this._status = 'error'
    this._lastError = error
  }

  public markDisposed(): void {
    this._status = 'disposed'
    this._lastError = null
    this._stale = false
  }

  public markStale(): void {
    this._stale = true
  }

  public countCompute(mode: 'full' | 'incremental'): void {
    this._computeCount++
    if (mode === 'full') {
      this._fullComputeCount++
    }
    else { this._incrementalComputeCount++ }
  }

  public countTargetWrites(count: number): void {
    this._targetWriteCount += count
  }

  public snapshot(): RaphDerivedNodeSnapshot {
    return {
      id: this._publicId,
      status: this._status,
      from: this._from,
      to: this._to,
      strategy: this._strategy.kind,
      computeCount: this._computeCount,
      fullComputeCount: this._fullComputeCount,
      incrementalComputeCount: this._incrementalComputeCount,
      targetWriteCount: this._targetWriteCount,
      stale: this._stale,
      lastError: this._lastError?.message ?? null,
    }
  }

  public get status(): RaphDerivedStatus {
    return this._status
  }

  public get lastError(): Error | null {
    return this._lastError
  }

  public get stale(): boolean {
    return this._stale
  }
}
