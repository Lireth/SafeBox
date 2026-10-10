import type { SafeBoxErrorPayload } from '../../../../shared/types'
import { t } from './i18n'

/**
 * IPC 错误解析（O31）：主进程 SafeBoxError 在 IPC 边界序列化为 JSON 信封
 * （{"code":"...","params":{...}}），本模块负责解析并按当前语言渲染文案；
 * 非信封错误（意外 bug 的原始 message）原样透传，保持既有行为。
 */

/** 解析错误信封；非信封（JSON 解析失败 / 结构不符 / 非 Error）返回 null */
export function readErrorPayload(err: unknown): SafeBoxErrorPayload | null {
  if (!(err instanceof Error)) return null
  try {
    const parsed = JSON.parse(err.message) as unknown
    if (parsed && typeof parsed === 'object' && typeof (parsed as SafeBoxErrorPayload).code === 'string') {
      const payload = parsed as SafeBoxErrorPayload
      // 参数若存在必须为普通对象，防止畸形信封击穿插值
      if (payload.params !== undefined && (typeof payload.params !== 'object' || payload.params === null)) {
        return null
      }
      return payload
    }
  } catch {
    // 非 JSON：普通错误文本
  }
  return null
}

/**
 * IPC 错误 → 当前语言文案：
 * - 信封错误：按 code 查 error.* 表（缺失兜底 zh → code 本身）
 * - field 参数为稳定键名（title/url/...），先经 error.field.* 转本地化字段名再插值
 * - 未知错误：原始 message（通常为主进程兜底中文），空则用调用方 fallback
 */
export function resolveIpcError(err: unknown, fallback: string): string {
  const payload = readErrorPayload(err)
  if (!payload) {
    const message = err instanceof Error ? err.message : ''
    return message || fallback
  }
  let params = payload.params
  const field = params?.field
  if (typeof field === 'string') {
    params = { ...params, field: t(`error.field.${field}`) }
  }
  return t(`error.${payload.code}`, params)
}
