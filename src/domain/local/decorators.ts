import type {
  RaphLocalPhaseDescriptor,
  RaphLocalPhaseMode,
  RaphLocalPhaseRunner,
  RaphLocalPropertyDescriptor,
} from '@/domain/local/types'
import type { RaphProperties } from '@/domain/types/base.types'
import { RaphPropagation } from '@/domain/local/types'

/**
 * Описывает тип PropertyOptions.
 */
type PropertyOptions = {
  phase: string
  default?: any
  propagation?: RaphPropagation
  dependsOn?: string[]
  compute?: (self: any) => any
}

/**
 * Описывает тип PhaseOptions.
 */
type PhaseOptions = {
  name?: string
  always?: boolean
  priority?: number
  mode?: RaphLocalPhaseMode
}

/**
 * Описывает тип NodeHandlerOptions.
 */
type NodeHandlerOptions = {
  phase: string
}

const propertyMetadata = new WeakMap<Function, Map<string | symbol, PropertyOptions>>()
const phaseMetadata = new WeakMap<Function, Map<string | symbol, PhaseOptions>>()
const nodeHandlerMetadata = new WeakMap<Function, Map<string, string>>()

/**
 * Выполняет публичную операцию raph local property.
 */
export function RaphLocalProperty(options: PropertyOptions): PropertyDecorator {
  return (target, propertyKey) => {
    const ctor = target.constructor
    const props = propertyMetadata.get(ctor) ?? new Map<string | symbol, PropertyOptions>()
    props.set(propertyKey, options)
    propertyMetadata.set(ctor, props)
  }
}

/**
 * Выполняет публичную операцию raph local phase.
 */
export function RaphLocalPhase(options: PhaseOptions = {}): MethodDecorator {
  return (target, propertyKey) => {
    const ctor = target.constructor
    const phases = phaseMetadata.get(ctor) ?? new Map<string | symbol, PhaseOptions>()
    phases.set(propertyKey, {
      ...options,
      name: options.name ?? propertyKey.toString(),
      mode: options.mode ?? 'dirty',
    })
    phaseMetadata.set(ctor, phases)
  }
}

/**
 * Выполняет публичную операцию raph local after.
 */
export function RaphLocalAfter(options: NodeHandlerOptions): MethodDecorator {
  return (target, propertyKey) => {
    const ctor = target.constructor
    const handlers = nodeHandlerMetadata.get(ctor) ?? new Map<string, string>()
    handlers.set(options.phase, propertyKey.toString())
    nodeHandlerMetadata.set(ctor, handlers)
  }
}

/**
 * Выполняет публичную операцию extract raph local properties.
 */
export function extractRaphLocalProperties<P extends RaphProperties>(
  instance: any,
): RaphLocalPropertyDescriptor<P, keyof P>[] {
  const raw = propertyMetadata.get(instance.constructor)
  if (!raw) {
    return []
  }

  const result: RaphLocalPropertyDescriptor<P, keyof P>[] = []

  for (const [key, options] of raw.entries()) {
    const name = key as keyof P
    const propagation = options.propagation ?? RaphPropagation.None
    const defaultValue = options.default
    let compute = options.compute

    if (!compute) {
      if (propagation === RaphPropagation.Down) {
        compute = (self: any) =>
          (self.get(name) ?? defaultValue ?? true) &&
          (self.parent?.get(name) ?? true)
      }
      else {
        compute = (self: any) => self.get(name) ?? defaultValue
      }
    }

    result.push({
      name,
      phase: options.phase,
      propagation,
      dependsOn: (options.dependsOn ?? []) as (keyof P)[],
      defaultValue,
      compute,
    })
  }

  return result
}

/**
 * Выполняет публичную операцию extract raph local phases.
 */
export function extractRaphLocalPhases<P extends RaphProperties>(
  instance: any,
): Array<RaphLocalPhaseDescriptor<P> & { process: RaphLocalPhaseRunner<P> }> {
  const raw = phaseMetadata.get(instance.constructor)
  if (!raw) {
    return []
  }

  const result: Array<RaphLocalPhaseDescriptor<P> & { process: RaphLocalPhaseRunner<P> }> = []

  for (const [key, options] of raw.entries()) {
    const method = instance[key as keyof typeof instance]
    result.push({
      name: options.name ?? key.toString(),
      process: method.bind(instance) as RaphLocalPhaseRunner<P>,
      priority: options.priority ?? 0,
      always: options.always ?? false,
      mode: options.mode ?? 'dirty',
    })
  }

  result.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
  return result
}

/**
 * Выполняет публичную операцию extract raph local after handlers.
 */
export function extractRaphLocalAfterHandlers(
  instance: any,
): { phase: string, methodName: string }[] {
  const raw = nodeHandlerMetadata.get(instance.constructor)
  if (!raw) {
    return []
  }

  return [...raw.entries()].map(([phase, methodName]) => ({ phase, methodName }))
}

export const RaphProperty = RaphLocalProperty
export const RaphAfter = RaphLocalAfter
