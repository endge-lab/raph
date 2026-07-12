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
    include: ['src/units/**/*.{spec,test}.ts'],
    exclude: [
      'src/units/benchmarks/**/*',
      'src/units/derived/**/*.memory.spec.ts',
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/main.ts',
        'src/docs/**',
        'src/units/**',
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
      include: ['src/units/benchmarks/**/*.{spec,test,bench}.ts'],
    },
  },
})
