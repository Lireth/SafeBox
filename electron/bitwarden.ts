import type { EntryDraft } from '../shared/types'
import { SafeBoxError } from './errors'

/**
 * Bitwarden 明文 JSON 导入映射（F22，纯逻辑零 IO）
 * - 仅支持 Bitwarden「未加密 JSON」导出（encrypted: false）；加密导出明确拒绝并引导重新导出
 * - 映射：name→标题、login.username/password/totp、login.uris[0].uri→网址、notes、favorite
 * - totp 字段（otpauth 链接或裸 Base32）原样透传，由 VaultStore.normalizeDraft 统一净化（F18 规则）
 * - 复用 mergeDrafts 按内容键去重与导入前强制备份，落盘链路零改动
 */

export interface BitwardenMappingResult {
  /** 可导入的草稿列表（name 非空） */
  drafts: EntryDraft[]
  /** 因缺少名称等被跳过的条目数 */
  invalid: number
}

/** 解析 Bitwarden 明文 JSON 导出并映射为 EntryDraft 列表 */
export function mapBitwardenJson(text: string): BitwardenMappingResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new SafeBoxError('BW_FORMAT', 'Bitwarden 导出文件格式错误（不是合法 JSON）')
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new SafeBoxError('BW_FORMAT', 'Bitwarden 导出文件格式错误（不是合法 JSON）')
  }
  const root = parsed as Record<string, unknown>
  if (root.encrypted === true) {
    throw new SafeBoxError('BW_ENCRYPTED', '该文件为 Bitwarden 加密导出：请改用「未加密 JSON」方式重新导出后重试')
  }
  if (!Array.isArray(root.items)) {
    throw new SafeBoxError('BW_NO_ITEMS', '不是有效的 Bitwarden 导出文件（缺少 items 数组）')
  }

  const drafts: EntryDraft[] = []
  let invalid = 0
  for (const raw of root.items) {
    if (typeof raw !== 'object' || raw === null) {
      invalid++
      continue
    }
    const item = raw as Record<string, unknown>
    const title = typeof item.name === 'string' ? item.name.trim() : ''
    if (!title) {
      invalid++
      continue
    }
    const login = typeof item.login === 'object' && item.login !== null ? (item.login as Record<string, unknown>) : {}
    const uris = Array.isArray(login.uris) ? login.uris : []
    const firstUri = uris.find(
      (u) => typeof u === 'object' && u !== null && typeof (u as Record<string, unknown>).uri === 'string',
    ) as Record<string, unknown> | undefined
    const totp = typeof login.totp === 'string' ? login.totp.trim() : ''
    drafts.push({
      title,
      category: 'other',
      url: firstUri ? String(firstUri.uri) : '',
      username: typeof login.username === 'string' ? login.username : '',
      password: typeof login.password === 'string' ? login.password : '',
      notes: typeof item.notes === 'string' ? item.notes : '',
      totpSecret: totp || undefined,
      favorite: item.favorite === true,
    })
  }
  return { drafts, invalid }
}
