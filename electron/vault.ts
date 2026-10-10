import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { safeStorage } from 'electron'
import type { AccountEntry, EntryDraft, LoadStatus, PasswordHistoryItem } from '../shared/types'

/**
 * 本地数据存储：无启动密码，应用启动即加载。
 * 落盘时优先使用系统级加密（Windows DPAPI / macOS Keychain），
 * 系统加密不可用时降级为明文 JSON。
 */

/** 保存时保留的轮换备份份数 */
const MAX_BACKUPS = 3

/**
 * 自动备份时间窗（毫秒）：距上次自动备份不足 60 秒则跳过复制，
 * 避免高频编辑（连续改收藏、逐字保存表单）时 IO 放大与近似备份挤占轮换名额。
 * 导入合并路径不受此窗约束（强制备份，见 backupCurrent 的 force 参数）。
 */
const BACKUP_WINDOW_MS = 60 * 1000

/** 回收站保留时长：超过后自动物理清理 */
export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

/** 历史密码保留条数上限 */
const PASSWORD_HISTORY_LIMIT = 5

/**
 * 数据磁盘文件结构。
 * version 历史：v1 主密码加密（已废弃，读取失败走 broken 备份）；v2 safeStorage 加密；
 * v3 条目支持软删除（deletedAt）；v4 条目支持 TOTP 秘钥（totpSecret）；
 * v5 条目支持历史密码（passwordHistory）；v6 条目支持 TOTP 参数（totpPeriod/totpDigits/totpAlgorithm，F18）。
 * v2~v6 结构向后兼容：新增字段均可选且缺省视为未启用，
 * 因此 load() 不做版本拦截，旧文件升级无缝兼容。
 */
interface StoreFile {
  version: number
  /** 是否使用 safeStorage 加密 */
  encrypted: boolean
  /** encrypted=true: base64(safeStorage 密文)；false: 明文 JSON */
  payload: string
}

/** 密文/明文内层结构 */
interface StorePayload {
  entries: AccountEntry[]
  savedAt: number
}

export class VaultStore {
  private readonly file: string
  private entries: AccountEntry[] = []
  private lastLoadResult: LoadStatus = { status: 'empty' }
  /** 最近一次自动备份的时间戳（毫秒）；0 表示从未备份，用于时间窗合并（issue #31） */
  private lastBackupAt = 0
  /** 已知 .bak 备份清单缓存（时间戳降序）；null 表示尚未做首次全量扫描 */
  private knownBaks: string[] | null = null

  constructor(userDataDir: string) {
    this.file = path.join(userDataDir, 'vault.safebox')
  }

  /** 启动加载状态（broken 表示文件损坏已备份，供 UI 展示警示） */
  getLoadStatus(): LoadStatus {
    return this.lastLoadResult
  }

  /** 清空内存数据（应用锁定时调用），磁盘文件不受影响 */
  clearMemory(): void {
    this.entries = []
  }

  /** 应用启动时加载数据（只需调用一次） */
  load(): void {
    this.lastLoadResult = { status: 'empty' }
    if (!fs.existsSync(this.file)) return
    try {
      const meta = JSON.parse(fs.readFileSync(this.file, 'utf-8')) as StoreFile
      let json: string
      if (meta.encrypted) {
        if (!safeStorage.isEncryptionAvailable()) {
          throw new Error('系统加密不可用')
        }
        json = safeStorage.decryptString(Buffer.from(meta.payload, 'base64'))
      } else {
        json = meta.payload
      }
      const data = JSON.parse(json) as StorePayload
      const rawEntries = Array.isArray(data.entries) ? data.entries : []
      // 逐条校验：磁盘文件可能因外部篡改或历史缺陷含格式非法条目，
      // 跳过坏条目以免击穿渲染端（如 title.charAt / f.toLowerCase 抛错），保留好条目
      const valid: AccountEntry[] = []
      let skipped = 0
      for (const raw of rawEntries) {
        const entry = normalizeEntry(raw)
        if (entry) valid.push(entry)
        else skipped++
      }
      this.entries = valid
      if (skipped > 0) {
        this.lastLoadResult = { status: 'repaired', skipped }
        console.warn(`[vault] 数据文件含 ${skipped} 条格式非法条目，已跳过并保留其余 ${valid.length} 条`)
      } else {
        this.lastLoadResult = { status: 'ok' }
      }
    } catch {
      // 旧版本主密码加密文件或损坏文件：备份后从空数据开始，并向上报告以便 UI 警示
      const backupName = `${path.basename(this.file)}.broken-${Date.now()}`
      try {
        fs.renameSync(this.file, path.join(path.dirname(this.file), backupName))
      } catch {
        // 备份失败也不阻塞启动
      }
      this.entries = []
      this.lastLoadResult = { status: 'broken', backupFile: backupName }
      console.warn(`[vault] 数据文件解析失败，已备份为 ${backupName}，本次从空数据启动`)
    }
  }

  list(): AccountEntry[] {
    return this.entries
  }

  add(draft: EntryDraft): AccountEntry {
    const now = Date.now()
    const entry: AccountEntry = {
      ...normalizeDraft(draft),
      id: crypto.randomUUID(),
      favorite: draft.favorite === true,
      createdAt: now,
      updatedAt: now,
    }
    this.commit([...this.entries, entry])
    return entry
  }

  /**
   * 编辑账号：密码实际变化且旧密码非空时，把旧值压入 passwordHistory（新→旧，保留最近 5 条）。
   * 历史由主进程派生，不接受渲染端提交（EntryDraft 无此字段，normalizeDraft 也不会产出）。
   */
  update(id: string, draft: EntryDraft): AccountEntry {
    const index = this.entries.findIndex((e) => e.id === id)
    if (index === -1) throw new Error('账号不存在')
    const previous = this.entries[index]
    const normalized = normalizeDraft(draft)
    const now = Date.now()
    const updated: AccountEntry = {
      ...previous,
      ...normalized,
      favorite: draft.favorite === true,
      updatedAt: now,
    }
    if (previous.password && previous.password !== normalized.password) {
      const history = [
        { password: previous.password, changedAt: now },
        ...(previous.passwordHistory ?? []),
      ].slice(0, PASSWORD_HISTORY_LIMIT)
      updated.passwordHistory = history
    }
    const next = [...this.entries]
    next[index] = updated
    this.commit(next)
    return updated
  }

  /**
   * 删除账号：软删除（标记 deletedAt 移入回收站）。
   * 条目保留在存储中，可经 restore() 恢复；updatedAt 不变（内容未被修改）。
   */
  remove(id: string): void {
    const index = this.entries.findIndex((e) => e.id === id)
    if (index === -1) throw new Error('账号不存在')
    if (this.entries[index].deletedAt) return
    const next = [...this.entries]
    next[index] = { ...this.entries[index], deletedAt: Date.now() }
    this.commit(next)
  }

  /** 从回收站恢复账号（清除软删除标记），返回恢复后的条目 */
  restore(id: string): AccountEntry {
    const index = this.entries.findIndex((e) => e.id === id)
    if (index === -1) throw new Error('账号不存在')
    if (!this.entries[index].deletedAt) throw new Error('该账号不在回收站中')
    const restored = { ...this.entries[index] }
    delete restored.deletedAt
    const next = [...this.entries]
    next[index] = restored
    this.commit(next)
    return restored
  }

  /**
   * 恢复回收站全部账号（F19）：清除所有软删除标记，返回恢复数量。
   * 回收站为空时不落盘（无变更），返回 0。
   */
  restoreAll(): number {
    const trashIds = new Set(this.entries.filter((e) => e.deletedAt).map((e) => e.id))
    if (trashIds.size === 0) return 0
    const next = this.entries.map((e) => {
      if (!trashIds.has(e.id)) return e
      const restored = { ...e }
      delete restored.deletedAt
      return restored
    })
    this.commit(next)
    return trashIds.size
  }

  /**
   * 清空回收站（F19）：物理删除所有软删除条目，返回删除数量。
   * 仅删除带 deletedAt 标记的条目——未删除数据不受影响（与 purge 的防误删语义一致）。
   * 回收站为空时不落盘，返回 0。
   */
  purgeAll(): number {
    const expiredIds = new Set(this.entries.filter((e) => e.deletedAt).map((e) => e.id))
    if (expiredIds.size === 0) return 0
    this.commit(this.entries.filter((e) => !expiredIds.has(e.id)))
    return expiredIds.size
  }

  /** 彻底删除回收站中的账号（物理删除，不可恢复）；不允许绕过软删除直接物理删除 */
  purge(id: string): void {
    const index = this.entries.findIndex((e) => e.id === id)
    if (index === -1) throw new Error('账号不存在')
    if (!this.entries[index].deletedAt) throw new Error('该账号不在回收站中')
    this.commit(this.entries.filter((e) => e.id !== id))
  }

  /**
   * 物理清理软删除超过 maxAgeMs 的条目（应用启动时调用），返回清理数量。
   * 用 >= 判断使 maxAgeMs=0 时所有已删除条目均被清理（测试与手动清空可用）。
   */
  purgeExpired(maxAgeMs: number): number {
    const now = Date.now()
    const expired = this.entries.filter((e) => typeof e.deletedAt === 'number' && now - e.deletedAt >= maxAgeMs)
    if (expired.length === 0) return 0
    const expiredIds = new Set(expired.map((e) => e.id))
    this.commit(this.entries.filter((e) => !expiredIds.has(e.id)))
    return expired.length
  }

  toggleFavorite(id: string): AccountEntry {
    const index = this.entries.findIndex((e) => e.id === id)
    if (index === -1) throw new Error('账号不存在')
    const updated: AccountEntry = {
      ...this.entries[index],
      favorite: !this.entries[index].favorite,
      updatedAt: Date.now(),
    }
    const next = [...this.entries]
    next[index] = updated
    this.commit(next)
    return updated
  }

  /**
   * 导入合并：跳过 id 已存在的条目（不静默覆盖），
   * 全部条目经 normalizeDraft 净化后一次性原子落盘（写盘失败整体回滚）。
   * 落盘前强制备份（绕过时间窗），保证「导入前」状态任何时刻可回滚。
   */
  mergeEntries(entries: AccountEntry[]): { imported: number; skipped: number } {
    const existing = new Set(this.entries.map((e) => e.id))
    const incoming: AccountEntry[] = []
    let skipped = 0
    for (const entry of entries) {
      if (entry === null || typeof entry !== 'object') {
        throw new Error('备份内容包含无效条目')
      }
      if (typeof entry.id === 'string' && existing.has(entry.id)) {
        skipped++
        continue
      }
      incoming.push(entry)
    }
    if (incoming.length === 0) return { imported: 0, skipped }

    const now = Date.now()
    const cleaned = incoming.map((entry) => ({
      id: typeof entry.id === 'string' && entry.id ? entry.id : crypto.randomUUID(),
      ...normalizeDraft(entry),
      // 备份条目的 TOTP 参数以独立字段透传（校验+默认归一，F18）：
      // normalizeDraft 仅能从 totpSecret 原始输入解析参数，而备份中的秘钥已是规范化裸 Base32
      ...sanitizeTotpParams(entry),
      favorite: entry.favorite === true,
      createdAt: typeof entry.createdAt === 'number' ? entry.createdAt : now,
      updatedAt: typeof entry.updatedAt === 'number' ? entry.updatedAt : now,
      // 备份可能包含回收站中的条目，恢复其软删除状态（非法值视为未删除）
      deletedAt: typeof entry.deletedAt === 'number' ? entry.deletedAt : undefined,
      // 历史密码透传（结构非法条目剔除、截断到上限；空结果归一为 undefined 不落盘冗余）
      passwordHistory: sanitizeHistory(entry.passwordHistory),
    }))
    this.commit([...this.entries, ...cleaned], true)
    return { imported: cleaned.length, skipped }
  }

  /**
   * CSV 等外部来源的草稿合并：按「规范化 title + 小写 username」内容键去重
   * （外部条目无本应用 id，不能复用按 id 去重的 mergeEntries）。
   * 全部草稿经 normalizeDraft 净化后一次性原子落盘；净化失败整体抛错回滚。
   */
  mergeDrafts(drafts: EntryDraft[]): { imported: number; skipped: number } {
    const contentKey = (title: string, username: string): string => `${title.toLowerCase()}::${username.toLowerCase()}`
    const existing = new Set(this.entries.map((e) => contentKey(e.title, e.username)))
    const cleaned: AccountEntry[] = []
    let skipped = 0
    const now = Date.now()
    for (const draft of drafts) {
      const normalized = normalizeDraft(draft)
      const key = contentKey(normalized.title, normalized.username)
      if (existing.has(key)) {
        skipped++
        continue
      }
      existing.add(key) // 同批 CSV 内部重复仅保留第一条
      cleaned.push({ ...normalized, id: crypto.randomUUID(), favorite: draft.favorite === true, createdAt: now, updatedAt: now })
    }
    if (cleaned.length === 0) return { imported: 0, skipped }
    this.commit([...this.entries, ...cleaned], true)
    return { imported: cleaned.length, skipped }
  }

  /**
   * 统一写入入口：应用内存变更并持久化。
   * 写盘失败时回滚内存到变更前状态，保证内存与磁盘始终一致，
   * 避免后续操作基于「假成功」状态扩大不一致。
   * （要求所有变更以不可变方式构造 next 数组，不原地修改旧对象）
   * forceBackup=true 用于导入合并等「大改动前必留底」场景，绕过自动备份时间窗。
   */
  private commit(next: AccountEntry[], forceBackup = false): void {
    const previous = this.entries
    this.entries = next
    try {
      this.save(forceBackup)
    } catch (err) {
      this.entries = previous
      throw err
    }
  }

  /** 加密并原子写入磁盘（临时文件 + 重命名）；真正产生新备份时才执行轮换 */
  private save(forceBackup = false): void {
    const json = JSON.stringify({ entries: this.entries, savedAt: Date.now() } satisfies StorePayload)
    let meta: StoreFile
    if (safeStorage.isEncryptionAvailable()) {
      meta = { version: 6, encrypted: true, payload: safeStorage.encryptString(json).toString('base64') }
    } else {
      meta = { version: 6, encrypted: false, payload: json }
    }
    const tmp = `${this.file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(meta), 'utf-8')
    // 覆盖前将上一份完好数据复制为 .bak，降低误写导致的数据丢失风险
    const newBak = this.backupCurrent(forceBackup)
    fs.renameSync(tmp, this.file)
    if (newBak) this.rotateBackups(newBak)
  }

  /**
   * 将当前数据文件复制为带时间戳的 .bak 备份，返回新备份文件名；
   * 未产生备份（时间窗内跳过 / 数据文件尚不存在 / 复制失败）返回 null。
   * 时间窗合并（issue #31）：距上次自动备份 < 60 秒则跳过，
   * 高频编辑时避免 IO 放大与近似备份挤占轮换名额；force=true 时无视时间窗。
   */
  private backupCurrent(force: boolean): string | null {
    const now = Date.now()
    if (!force && now - this.lastBackupAt < BACKUP_WINDOW_MS) return null
    try {
      if (!fs.existsSync(this.file)) return null
      const bakName = `${path.basename(this.file)}.bak-${now}`
      fs.copyFileSync(this.file, path.join(path.dirname(this.file), bakName))
      this.lastBackupAt = now
      return bakName
    } catch {
      // 备份失败不阻塞保存
      return null
    }
  }

  /**
   * 轮换保留最近 MAX_BACKUPS 份 .bak，超出部分删除。
   * 仅在真正产生新备份时调用（issue #31）；
   * 备份清单缓存在内存（knownBaks，时间戳降序），进程内免重复 readdir+stat；
   * 首次（含进程重启后）全量扫描一次磁盘，确保遗留旧备份纳入轮换、封顶承诺不被打破。
   */
  private rotateBackups(newBak: string): void {
    try {
      if (this.knownBaks === null) {
        // 首次全量扫描：新备份已在结果中（同毫秒重名）时移到首位，否则直接前插
        const scanned = this.scanBakFiles()
        this.knownBaks = scanned[0] === newBak ? scanned : [newBak, ...scanned]
      } else if (this.knownBaks[0] !== newBak) {
        // 同毫秒重采时文件名相同（磁盘文件已被覆盖，无新增），不重复计入缓存
        this.knownBaks.unshift(newBak)
      }
      for (const stale of this.knownBaks.splice(MAX_BACKUPS)) {
        try {
          fs.unlinkSync(path.join(path.dirname(this.file), stale))
        } catch {
          // 单个备份删除失败可忽略：放回缓存，下次轮换重试
          this.knownBaks.push(stale)
        }
      }
    } catch {
      // 轮换失败不影响主流程
    }
  }

  /** 全量扫描磁盘上的 .bak 备份文件名，按文件名内嵌时间戳降序 */
  private scanBakFiles(): string[] {
    const prefix = `${path.basename(this.file)}.bak-`
    return fs
      .readdirSync(path.dirname(this.file))
      .filter((name) => name.startsWith(prefix))
      .sort((a, b) => Number(b.slice(prefix.length)) - Number(a.slice(prefix.length)))
  }
}

/**
 * 读取侧逐条校验磁盘条目：必备字段类型不符的坏条目返回 null（由 load() 跳过计数）。
 * 与写入侧 normalizeDraft 互补：写入拒绝非法输入，读取容忍历史/外部损坏数据。
 * 可选字段（deletedAt/totpSecret）非法时仅清除该字段，不连坐整条记录。
 */
function normalizeEntry(raw: unknown): AccountEntry | null {
  if (typeof raw !== 'object' || raw === null) return null
  const e = raw as Record<string, unknown>
  const isStr = (v: unknown): v is string => typeof v === 'string'
  if (
    !isStr(e.id) ||
    !isStr(e.title) ||
    !isStr(e.category) ||
    !isStr(e.url) ||
    !isStr(e.username) ||
    !isStr(e.password) ||
    !isStr(e.notes) ||
    typeof e.favorite !== 'boolean' ||
    typeof e.createdAt !== 'number' ||
    typeof e.updatedAt !== 'number'
  ) {
    return null
  }
  const entry: AccountEntry = {
    id: e.id,
    title: e.title,
    category: CATEGORY_IDS.includes(e.category) ? e.category : 'other',
    url: e.url,
    username: e.username,
    password: e.password,
    notes: e.notes,
    favorite: e.favorite,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  }
  if (typeof e.deletedAt === 'number') entry.deletedAt = e.deletedAt
  if (isStr(e.totpSecret) && e.totpSecret) {
    entry.totpSecret = e.totpSecret
    // TOTP 参数字段仅在秘钥存在时有意义；非法值静默丢弃、默认值归一（F18）
    Object.assign(entry, sanitizeTotpParams(e))
  }
  // 历史密码：逐条校验结构，非法条目剔除；全部非法或空数组则不设置该字段
  const history = sanitizeHistory(e.passwordHistory)
  if (history) entry.passwordHistory = history
  return entry
}

/** 历史密码数组净化：剔除非对象/字段类型错误的条目，截断到上限；空结果返回 undefined */
function sanitizeHistory(raw: unknown): PasswordHistoryItem[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const history = raw.filter(
    (item): item is PasswordHistoryItem =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as PasswordHistoryItem).password === 'string' &&
      typeof (item as PasswordHistoryItem).changedAt === 'number',
  )
  return history.length > 0 ? history.slice(0, PASSWORD_HISTORY_LIMIT) : undefined
}

/** 校验并规范化渲染进程提交的账号数据 */
function normalizeDraft(draft: EntryDraft): Omit<AccountEntry, 'id' | 'favorite' | 'createdAt' | 'updatedAt'> {
  if (typeof draft !== 'object' || draft === null) {
    throw new Error('数据格式错误')
  }
  const str = (value: unknown, max: number, field: string): string => {
    if (value === undefined || value === null) return ''
    if (typeof value !== 'string') throw new Error(`${field} 格式错误`)
    const trimmed = value.trim()
    if (trimmed.length > max) throw new Error(`${field}过长（最多 ${max} 字符）`)
    return trimmed
  }

  const title = str(draft.title, 100, '名称')
  if (!title) throw new Error('请填写账号名称')

  // TOTP 秘钥与参数一并解析（F18）；三参数键恒存在（值可 undefined），
  // 保证 update() 的 spread 覆盖能正确清除旧参数
  const totp = normalizeTotp(draft.totpSecret)
  return {
    title,
    // 分类不在预置列表时归入 other
    category: CATEGORY_IDS.includes(draft.category) ? draft.category : 'other',
    url: str(draft.url, 500, '网址'),
    username: str(draft.username, 200, '用户名'),
    password: typeof draft.password === 'string' ? draft.password.slice(0, 500) : '',
    notes: str(draft.notes, 2000, '备注'),
    totpSecret: totp?.secret,
    totpPeriod: totp?.period,
    totpDigits: totp?.digits,
    totpAlgorithm: totp?.algorithm,
  }
}

/** TOTP 解析结果（存储侧）：默认参数（30/6/SHA1）归一为 undefined 不落盘，保持数据最小冗余 */
interface StoredTotp {
  secret: string
  period?: number
  digits?: number
  algorithm?: 'SHA1' | 'SHA256' | 'SHA512'
}

/**
 * TOTP 秘钥存储侧规范化（F18 扩展参数解析）：otpauth:// 链接提取 secret/period/digits/algorithm，
 * 裸 Base32 做字符集校验（参数全默认）。空输入返回 undefined。
 * 校验规则与渲染端 lib/totp.ts 的 parseTotpParams 保持一致（渲染端为完整实现，此处为存储校验）。
 */
function normalizeTotp(raw: unknown): StoredTotp | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined
  if (typeof raw !== 'string') throw new Error('TOTP 秘钥格式错误')
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  if (trimmed.length > 500) throw new Error('TOTP 秘钥过长')

  let secret: string
  let period: number | undefined
  let digits: number | undefined
  let algorithm: StoredTotp['algorithm']

  if (trimmed.toLowerCase().startsWith('otpauth://')) {
    let url: URL
    let rawSecret: string | null
    try {
      url = new URL(trimmed)
      if (url.protocol !== 'otpauth:' || url.host.toLowerCase() !== 'totp') throw new Error('bad type')
      rawSecret = url.searchParams.get('secret')
    } catch {
      throw new Error('otpauth 链接格式错误（仅支持 totp 类型）')
    }
    if (!rawSecret) throw new Error('otpauth 链接缺少 secret 参数')
    secret = assertBase32(rawSecret)
    period = parseStoredPeriod(url.searchParams.get('period'))
    digits = parseStoredDigits(url.searchParams.get('digits'))
    algorithm = parseStoredAlgorithm(url.searchParams.get('algorithm'))
  } else {
    secret = assertBase32(trimmed)
  }

  const result: StoredTotp = { secret }
  if (period !== undefined) result.period = period
  if (digits !== undefined) result.digits = digits
  if (algorithm !== undefined) result.algorithm = algorithm
  return result
}

/** otpauth period 参数（存储侧）：缺省/默认 30 不落盘；须为 1-3600 整数 */
function parseStoredPeriod(raw: string | null): number | undefined {
  if (raw === null || raw === '') return undefined
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1 || value > 3600) throw new Error('TOTP 周期须为 1-3600 的整数（秒）')
  return value === 30 ? undefined : value
}

/** otpauth digits 参数（存储侧）：缺省/默认 6 不落盘；仅支持 6 或 8 */
function parseStoredDigits(raw: string | null): number | undefined {
  if (raw === null || raw === '') return undefined
  const value = Number(raw)
  if (value !== 6 && value !== 8) throw new Error('TOTP 位数仅支持 6 或 8 位')
  return value === 6 ? undefined : value
}

/** otpauth algorithm 参数（存储侧）：缺省/默认 SHA1 不落盘；大小写与连字符不敏感 */
function parseStoredAlgorithm(raw: string | null): StoredTotp['algorithm'] {
  if (raw === null || raw === '') return undefined
  const value = raw.toUpperCase().replace(/-/g, '')
  if (value !== 'SHA1' && value !== 'SHA256' && value !== 'SHA512') {
    throw new Error('TOTP 算法仅支持 SHA1 / SHA256 / SHA512')
  }
  return value === 'SHA1' ? undefined : value
}

/**
 * 读取 / 导入侧校验条目上既存的 TOTP 参数字段（F18）：
 * 非法值静默丢弃、默认值归一不落盘，与 normalizeTotp 的写入侧规则一致。
 * 返回键名与 AccountEntry 字段一致，可直接 spread 进条目。
 */
function sanitizeTotpParams(raw: {
  totpPeriod?: unknown
  totpDigits?: unknown
  totpAlgorithm?: unknown
}): Pick<AccountEntry, 'totpPeriod' | 'totpDigits' | 'totpAlgorithm'> {
  const out: Pick<AccountEntry, 'totpPeriod' | 'totpDigits' | 'totpAlgorithm'> = {}
  const period = raw.totpPeriod
  if (typeof period === 'number' && Number.isInteger(period) && period >= 1 && period <= 3600 && period !== 30) {
    out.totpPeriod = period
  }
  if (raw.totpDigits === 8) out.totpDigits = 8
  const algorithm = raw.totpAlgorithm
  if (algorithm === 'SHA256' || algorithm === 'SHA512') out.totpAlgorithm = algorithm
  return out
}

/** Base32 校验与规范化（存储侧） */
function assertBase32(raw: string): string {
  const compact = raw.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase()
  if (compact.length < 8) throw new Error('TOTP 秘钥过短（至少 8 个 Base32 字符）')
  if (compact.length > 128) throw new Error('TOTP 秘钥过长')
  if (!/^[A-Z2-7]+$/.test(compact)) throw new Error('TOTP 秘钥不是有效的 Base32（仅允许 A-Z 和 2-7）')
  return compact
}

// 与渲染端 categories 保持一致，仅用于服务端校验
const CATEGORY_IDS = ['dev', 'social', 'email', 'finance', 'shopping', 'work', 'study', 'other']
