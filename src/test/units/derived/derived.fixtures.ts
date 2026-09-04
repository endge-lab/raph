import { RaphKernel } from '@/domain/core/RaphKernel'
import { SchedulerType } from '@/domain/types/base.types'

export function createDerivedFixture() {
  const kernel = new RaphKernel()
  const runtime = kernel.createRuntime({ id: 'derived-test', scheduler: SchedulerType.Sync })
  runtime.init()
  return { kernel, runtime }
}

export function projectRows(rows: Array<{ id: number, value?: number, name?: string }>) {
  return rows.map(row => ({
    id: row.id,
    label: `${row.name ?? ''}:${row.value ?? 0}`,
  }))
}
