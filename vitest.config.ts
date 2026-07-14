import path from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/test/units/**/*.{spec,test}.ts'],
    exclude: [
      'src/test/units/benchmarks/**/*',
      'src/test/units/derived/**/*.memory.spec.ts',
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/main.ts',
        'src/docs/**',
        'src/test/units/**',
        'src/**/*.spec.ts',
        'src/**/*.test.ts',
      ],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
    benchmark: {
      include: ['src/test/units/benchmarks/**/*.{spec,test,bench}.ts'],
    },
  },
})
