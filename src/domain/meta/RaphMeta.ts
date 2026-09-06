import type { RaphKernel } from '@/domain/core/RaphKernel'
import type { RaphRuntime } from '@/domain/core/RaphRuntime'
import type { DataPathDef } from '@/domain/types/base.types'
import type { RaphMetaReadOptions, RaphMetaWatchCallback, RaphMetaWatchOptions, RaphMetaWriteOptions } from '@/domain/types/meta.types'

import { RaphMetaWatch } from '@/domain/reactivity/RaphMetaWatch'

/** Публичный фасад отдельного Meta-plane конкретного kernel/runtime. */
export class RaphMeta {
  private _watchCounter = 0

  public constructor(private readonly _kernel: RaphKernel, private readonly _runtime?: RaphRuntime<any>) {}

  public get(path: DataPathDef, namespace?: string, options?: RaphMetaReadOptions): unknown {
    return this._kernel.getMeta(path, namespace, options)
  }

  public has(path: DataPathDef, namespace?: string, options?: RaphMetaReadOptions): boolean {
    return this._kernel.hasMeta(path, namespace, options)
  }

  public set(path: DataPathDef, namespace: string, value: unknown, options?: RaphMetaWriteOptions): void {
    this._kernel.setMeta(path, namespace, value, options)
  }

  public merge(path: DataPathDef, namespace: string, value: unknown, options?: RaphMetaWriteOptions): void {
    this._kernel.mergeMeta(path, namespace, value, options)
  }

  public delete(path: DataPathDef, namespace?: string, options?: RaphMetaWriteOptions): void {
    this._kernel.deleteMeta(path, namespace, options)
  }

  public watch(pathOrMask: DataPathDef | DataPathDef[], callback: RaphMetaWatchCallback, options: RaphMetaWatchOptions = {}): () => void {
    if (!this._runtime) {
      throw new Error('[RaphMeta] watch requires a runtime-bound Meta facade.')
    }
    const masks = Array.isArray(pathOrMask) ? pathOrMask : [pathOrMask]
    const node = new RaphMetaWatch(this._runtime, `__metaWatch.${this._watchCounter++}`, masks, callback, options)
    return () => node.remove()
  }
}
