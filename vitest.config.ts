import path from 'node:path'
import { defineConfig } from 'vitest/config'

// 单元测试配置：electron 主进程模块依赖运行时 API，统一 alias 到替身模块
export default defineConfig({
  resolve: {
    alias: {
      electron: path.resolve(__dirname, 'tests/mocks/electron.ts'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
