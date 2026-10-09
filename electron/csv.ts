import type { EntryDraft } from '../shared/types'

/**
 * 第三方密码管理器 CSV 导入解析（纯逻辑，零 IO）
 * - parseCsvRows：RFC 4180 解析（引号包裹、"" 转义、CRLF、字段内换行），剥离 BOM
 * - mapCsvEntries：按表头列名映射为 EntryDraft 列表，兼容 Chrome / Bitwarden / 1Password 常见导出格式
 *   表头归一化后匹配候选列（大小写、空格、下划线、连字符不敏感）
 */

/** 解析 CSV 文本为二维字符串数组（含表头行）；空文本返回 [] */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  // 剥离 UTF-8 BOM（部分导出工具带 BOM）
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      // \r\n 视为一个换行；字段内换行已被 inQuotes 分支处理
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(field)
      field = ''
      rows.push(row)
      row = []
    } else {
      field += ch
    }
  }
  // 收尾：最后一个字段 / 最后一行（无结尾换行时）
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

/** 表头归一化：小写、去空格/下划线/连字符 */
function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[\s_-]+/g, '')
}

/** 目标字段 → 候选表头（归一化后）映射，覆盖 Chrome / Bitwarden / 1Password / LastPass 常见列名 */
const COLUMN_CANDIDATES: Record<'title' | 'url' | 'username' | 'password' | 'notes' | 'totpSecret', string[]> = {
  title: ['name', 'title', 'nametitle'],
  url: ['origin', 'url', 'loginuri', 'uri', 'urls', 'faviconurl', 'urilist'],
  username: ['username', 'user', 'loginusername', 'account', 'email'],
  password: ['password', 'loginpassword', 'pass'],
  notes: ['note', 'notes', 'notetext'],
  totpSecret: ['otpauthtoken', 'loginotpauthtoken', 'totp', 'logintotp', 'secret', 'authkey', 'otp'],
}

/** 表头行 → 各目标字段的列索引（-1 表示缺失） */
export function mapCsvHeader(header: string[]): Record<'title' | 'url' | 'username' | 'password' | 'notes' | 'totpSecret', number> {
  const norm = header.map(normalizeHeader)
  const index = {} as Record<'title' | 'url' | 'username' | 'password' | 'notes' | 'totpSecret', number>
  for (const key of Object.keys(COLUMN_CANDIDATES) as Array<keyof typeof COLUMN_CANDIDATES>) {
    index[key] = norm.findIndex((h) => COLUMN_CANDIDATES[key].includes(h))
  }
  return index
}

export interface CsvMappingResult {
  /** 可导入的草稿列表（title 非空） */
  drafts: EntryDraft[]
  /** 因缺少名称被跳过的行数 */
  invalid: number
}

/**
 * 将 CSV 行（含表头）映射为 EntryDraft 列表。
 * 无名称列或表头完全无法识别时抛中文错误；行级缺名称计入 invalid。
 */
export function mapCsvEntries(rows: string[][]): CsvMappingResult {
  if (rows.length === 0) throw new Error('CSV 文件为空')
  const header = mapCsvHeader(rows[0])
  if (header.title === -1) {
    throw new Error('无法识别 CSV 表头：需要包含名称列（name / Title 等），请确认使用密码管理器的标准导出格式')
  }
  const drafts: EntryDraft[] = []
  let invalid = 0
  for (const row of rows.slice(1)) {
    if (row.length === 1 && row[0].trim() === '') continue // 空行
    const get = (idx: number): string => (idx >= 0 && idx < row.length ? row[idx].trim() : '')
    const title = get(header.title)
    if (!title) {
      invalid++
      continue
    }
    // Bitwarden 等导出会在 TOTP 列追加 "|" 分隔的参数尾巴，截断取 URI/Base32 主体
    const totp = get(header.totpSecret).split('|')[0]
    drafts.push({
      title,
      category: 'other',
      url: get(header.url),
      username: get(header.username),
      password: get(header.password),
      notes: get(header.notes),
      totpSecret: totp || undefined,
    })
  }
  return { drafts, invalid }
}
