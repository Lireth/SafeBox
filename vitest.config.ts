import path from 'node:path'
import { defineConfig } from 'vitest/config'

// 单元测试配置：electron 主进程模块依赖运行时 API，alias 到替身模块；
// electron-updater 的替身由 updater.test.ts 内 vi.mock + vi.hoisted 提供（不用 alias，避免双模块实例）
export default defineConfig({
  resolve: {
    alias: {
      electron: path.resolve(__dirname, 'tests/mocks/electron.ts')
    }
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node'
  }
})
