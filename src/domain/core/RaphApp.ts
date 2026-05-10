import { RaphKernel } from '@/domain/core/RaphKernel'
import { RaphRuntime } from '@/domain/core/RaphRuntime'
import type { RaphProperties } from '@/domain/types/base.types'
import type { RaphRuntimeOptions } from '@/domain/types/runtime.types'

/**
 * Backward-compatible Raph application facade.
 *
 * По умолчанию создает собственный RaphKernel, но может быть подключен к shared kernel.
 */
export class RaphApp<Props extends RaphProperties = RaphProperties> extends RaphRuntime<Props> {
  /**
   * Создает совместимый Raph runtime.
   */
  constructor(options: RaphRuntimeOptions & { kernel?: RaphKernel } = {}) {
    super({
      ...options,
      id: options.id ?? 'default',
      kernel: options.kernel ?? new RaphKernel(),
    })
  }
}
