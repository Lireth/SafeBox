import type { SafeBoxErrorCode, SafeBoxErrorPayload } from '../shared/types'

/**
 * 业务错误（O31）：主进程各模块以「错误码 + 中文兜底文案」抛出，
 * message 保持中文（主进程单测断言与日志不受影响）；
 * 在 IPC 边界由 toIpcError 序列化为 JSON 信封（跨 IPC 仅 message 存活），
 * 渲染端 resolveIpcError 按 code 查 locale 表渲染当前语言文案。
 */
export class SafeBoxError extends Error {
  readonly code: SafeBoxErrorCode
  readonly params?: Record<string, string | number>

  constructor(code: SafeBoxErrorCode, zhMessage: string, params?: Record<string, string | number>) {
    super(zhMessage)
    this.name = 'SafeBoxError'
    this.code = code
    this.params = params
  }
}

/**
 * IPC 边界转换：SafeBoxError → JSON 信封 Error（渲染端解析 code/params），
 * 其余错误（意外 bug 等）原样透传，渲染端按原始 message 展示。
 */
export function toIpcError(err: unknown): unknown {
  if (err instanceof SafeBoxError) {
    const payload: SafeBoxErrorPayload = err.params ? { code: err.code, params: err.params } : { code: err.code }
    return new Error(JSON.stringify(payload))
  }
  return err
}
