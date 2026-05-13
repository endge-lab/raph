import type { RaphNode } from '@/domain/core/RaphNode'
import type { RaphFrameContext, RaphProperties } from '@/domain/types/base.types'
import type {
  RaphLocalNodeCallback,
  RaphLocalPhaseMode,
  RaphLocalPhaseRunner,
} from '@/domain/local/local.types'
import type { RaphLocalPropertyRuntime } from '@/domain/local/raph-local-property'

/**
 * Хранит runtime-описание local phase и правила ее выполнения.
 */
export class RaphLocalPhaseRuntime<P extends RaphProperties = RaphProperties> {
  readonly properties: Array<RaphLocalPropertyRuntime<P, any>> = []

  /**
   * Создает instance и подготавливает внутреннее состояние.
   */
  constructor(
    public readonly name: string,
    public readonly mode: RaphLocalPhaseMode,
    public readonly process: RaphLocalPhaseRunner<P>,
    public readonly beforeProcess?: RaphLocalNodeCallback<P>,
    public afterProcess?: RaphLocalNodeCallback<P>,
    public readonly always = false,
    public readonly priority = 0,
  ) {}

  /**
   * Добавляет property.
   */
  addProperty(prop: RaphLocalPropertyRuntime<P, any>): void {
    this.properties.push(prop)
  }

  /**
   * Выполняет внутреннюю операцию finalize.
   */
  finalize(): void {
    const sorted: Array<RaphLocalPropertyRuntime<P, any>> = []
    const visited = new Set<string>()
    const visiting = new Set<string>()
    const byName = new Map<string, RaphLocalPropertyRuntime<P, any>>()

    for (const prop of this.properties) {
      byName.set(String(prop.name), prop)
    }

    const visit = (name: string): void => {
      if (visited.has(name)) {
        return
      }
      if (visiting.has(name)) {
        throw new Error(`[RaphLocalPhase] Circular dependency: "${name}"`)
      }

      const prop = byName.get(name)
      if (!prop) {
        return
      }

      visiting.add(name)
      for (const dep of prop.dependsOn) {
        visit(String(dep))
      }
      visiting.delete(name)
      visited.add(name)
      sorted.push(prop)
    }

    for (const prop of this.properties) {
      visit(String(prop.name))
    }

    this.properties.splice(0, this.properties.length, ...sorted)
  }

  /**
   * Выполняет внутреннюю операцию run.
   */
  run(payload: {
    frame: RaphFrameContext
    root: RaphNode<P>
    dirty: Array<RaphNode<P>>
  }): void {
    this.process({
      phase: this,
      frame: payload.frame,
      root: payload.root,
      dirty: payload.dirty,
    })
  }
}
