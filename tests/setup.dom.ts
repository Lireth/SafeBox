/**
 * jsdom 组件测试环境初始化（vitest dom project 的 setupFiles）
 * - jest-dom 匹配器（toBeInTheDocument 等）
 * - WebCrypto 注入：jsdom 的 window.crypto 无 subtle 实现，
 *   AuditModal 的重复密码检测（audit.ts sha256Hex）依赖 crypto.subtle，
 *   用 Node 内置 webcrypto 替换（与渲染端真实 Chromium 实现语义一致）
 * - 每个用例后卸载组件树，防止跨用例 DOM 泄漏
 */
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { webcrypto } from 'node:crypto'
import { afterEach } from 'vitest'

Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })

afterEach(() => {
  cleanup()
})
