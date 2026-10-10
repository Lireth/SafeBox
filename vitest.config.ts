import path from 'node:path'
import { defineConfig } from 'vitest/config'

// ============================================================
// 单元测试配置：双 project 环境分离（issue #29）
// - node：主进程模块（electron 裸导入经 alias 指向替身）+ 渲染端纯逻辑
// - dom：渲染端组件测试（jsdom + Testing Library），setup 注入 WebCrypto
// `npm test` 一条命令同时跑两个 project
// electron-updater 的替身由 updater.test.ts 内 vi.mock + vi.hoisted 提供（不用 alias，避免双模块实例）
// ============================================================
export default defineConfig({
  test: {
    // 覆盖率门槛（issue #30）：仅统计「可单测的核心逻辑」——
    // 主进程数据/安全模块（electron/，排除需真实 Electron 运行时、由打包冒烟覆盖的
    // 装配层 main/preload/ipc/tray）+ 渲染端纯逻辑 lib（组件由 dom project 覆盖，不计入此处）。
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: 'coverage',
      include: ['electron/**/*.ts', 'src/renderer/src/lib/**/*.ts'],
      exclude: ['electron/main.ts', 'electron/preload.ts', 'electron/ipc.ts', 'electron/tray.ts'],
      // 全局阈值：核心逻辑基线（当前实测 ~95%），回落到 90% 以下视为回归
      thresholds: { statements: 90, branches: 85, functions: 90, lines: 90 },
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['tests/electron/**/*.test.ts', 'tests/renderer/**/*.test.ts'],
        },
        resolve: {
          alias: {
            electron: path.resolve(__dirname, 'tests/mocks/electron.ts'),
          },
        },
      },
      {
        extends: true,
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['tests/components/**/*.test.tsx'],
          setupFiles: ['tests/setup.dom.ts'],
        },
        // 组件测试的 .tsx 走 React 19 automatic JSX 运行时（无需 import React）
        esbuild: { jsx: 'automatic' },
      },
    ],
  },
})
