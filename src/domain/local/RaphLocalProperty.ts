import type { RaphNode } from '@/domain/core/RaphNode'
import type { RaphProperties } from '@/domain/types/base.types'
import { RaphPropagation } from '@/domain/local/local.types'
import type { RaphLocalPropertyCompute } from '@/domain/local/local.types'

/**
 * Хранит runtime-описание local property и способ ее вычисления.
 */
export class RaphLocalPropertyRuntime<P extends RaphProperties, K extends keyof P> {
  /**
   * Создает instance и подготавливает внутреннее состояние.
   */
  constructor(
    public readonly name: K,
    public readonly phase: string,
    public readonly propagation: RaphPropagation,
    private readonly compute?: RaphLocalPropertyCompute<P, K>,
    public readonly dependsOn: (keyof P)[] = [],
    public readonly defaultValue?: P[K],
  ) {}

  /**
   * Выполняет внутреннюю операцию set.
   */
  set(node: RaphNode<P>, value: P[K]): void {
    node.setLocal(this.name, value)
    node.raph.dirty(this.phase as any, node)
  }

  /**
   * Выполняет внутреннюю операцию get.
   */
  get(node: RaphNode<P>): P[K] {
    const value = node.getLocal(this.name)
    return (value ?? this.defaultValue) as P[K]
  }

  /**
   * Выполняет внутреннюю операцию compute on.
   */
  computeOn(node: RaphNode<P>): void {
    if (this.compute) {
      node.setLocal(this.name, this.compute(node))
      return
    }

    const current = node.getLocal(this.name)
    node.setLocal(this.name, (current ?? this.defaultValue) as P[K])
  }
}
