import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    environment: 'node',
    include: [
      'src/test/units/derived/**/*.memory.spec.ts',
      'src/test/units/router/**/*.memory.spec.ts',
      'src/test/units/runtime/**/*.memory.spec.ts',
    ],
    pool: 'threads',
    testTimeout: 30_000,
  },
})
