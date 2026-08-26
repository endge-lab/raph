import path from 'path'
import { defineConfig } from 'vite'
import dts from 'unplugin-dts/vite'

// https://vite.dev/config/
export default defineConfig({
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/main.ts'),
      formats: ['es', 'cjs'],
      fileName: 'raph',
      name: 'raph',
    },
    rollupOptions: {
      external: ['vue'],
      output: {
        globals: {
          Vue: 'vue',
        },
      },
    },
  },
  plugins: [dts({
    bundleTypes: false,
    tsconfigPath: './tsconfig.app.json',
    exclude: [
      'src/test/units/**/*',
      'src/**/*.spec.ts',
      'src/**/*.test.ts',
    ],
  })],
  worker: {
    format: 'es',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
