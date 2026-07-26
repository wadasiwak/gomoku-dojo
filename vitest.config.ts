// vitest 獨立設定：不 import vite.config（vite 8 rolldown 型別與 vitest 內建
// vite 的 rollup 型別互撞），引擎測試也不需要任何 vite plugin。
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
    environment: 'node',
  },
})
