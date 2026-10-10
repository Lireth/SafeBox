import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { app } from 'electron'

/**
 * 主进程诊断日志层（issue #35）
 * - 环形缓冲：内存保留最近 MAX_BUFFER 条（时间戳/级别/消息），导出与排障共用
 * - 落盘轮转：userData/logs/main.log 超 MAIN_LOG_MAX_BYTES 时滚动为 main.1.log（上限 1MB×2）
 * - 脱敏红线：写入前对敏感键值做掩码兜底；现有日志点本身已合规，此处防御未来误写
 * - console 劫持：initLogger 后主进程 console.* 同时进入缓冲、文件与原 stdout，
 *   业务代码零改动（打包版 GUI 子系统无控制台，落盘是用户侧问题唯一可观测途径）
 */

/** 环形缓冲上限（条） */
const MAX_BUFFER = 500
/** 单文件落盘上限（字节），超出即轮转 */
const MAIN_LOG_MAX_BYTES = 1024 * 1024

/** 一条日志记录 */
export interface LogRecord {
  /** 毫秒时间戳 */
  ts: number
  /** 级别：info / warn / error（console.* 方法名） */
  level: string
  /** 已脱敏并拼接为单行的消息 */
  msg: string
}

/**
 * 敏感键名（小写匹配）：任何形如 key: value / key=value 的结构中
 * key 命中以下子串即整体掩码。覆盖密码、PIN、TOTP、备份口令、秘钥等。
 */
const SENSITIVE_KEYS = [
  'password', 'passwd', 'pwd', 'pin', 'secret', 'totp',
  'token', 'credential', 'passphrase', 'authorization',
]

/** 键值对脱敏正则：key 后接冒号或等号，值掩码为 *** */
const KV_RE = new RegExp(
  `([\\w-]*(?:${SENSITIVE_KEYS.join('|')})[\\w-]*)\\s*[:=]\\s*(\\S[^,;\\n]*)`,
  'gi',
)

/**
 * 脱敏兜底：对消息做键值掩码 + 疑似 Base32/长秘钥掩码。
 * 宁可多掩不可漏掩——诊断日志绝不允许出现明文敏感值。
 */
export function sanitize(text: string): string {
  let out = text.replace(KV_RE, (_m, key: string) => `${key}=***`)
  // 连续 26+ 位 Base32 字符（TOTP 秘钥典型形态）整体掩码
  out = out.replace(/\b[A-Z2-7]{26,}\b/g, '[REDACTED-SECRET]')
  return out
}

/** 单条记录格式化为落盘/导出行 */
function formatRecord(r: LogRecord): string {
  const d = new Date(r.ts)
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0')
  const ts = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
  return `${ts} [${r.level.toUpperCase()}] ${r.msg}`
}

/** 把 console 的多个参数拼接为单行文本 */
function argsToText(args: unknown[]): string {
  return args
    .map((a) => {
      if (a instanceof Error) return a.stack ?? a.message
      if (typeof a === 'string') return a
      try {
        return JSON.stringify(a)
      } catch {
        return String(a)
      }
    })
    .join(' ')
}

// ---- 模块级状态 ----
let buffer: LogRecord[] = []
let logsDir = ''
let initialized = false
/** 原始 console 方法（劫持前保存，落盘失败时兜底输出） */
const native = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  debug: console.debug.bind(console),
}

/** 追加一条记录：入缓冲 + 落盘（内部使用，已脱敏） */
function push(level: string, msg: string): void {
  const rec: LogRecord = { ts: Date.now(), level, msg: sanitize(msg) }
  buffer.push(rec)
  if (buffer.length > MAX_BUFFER) buffer.splice(0, buffer.length - MAX_BUFFER)
  writeLine(formatRecord(rec))
}

/** 落盘一行：检查轮转后 appendFileSync；IO 失败静默（日志层绝不能拖垮主流程） */
function writeLine(line: string): void {
  if (!logsDir) return
  try {
    const main = path.join(logsDir, 'main.log')
    if (fs.existsSync(main) && fs.statSync(main).size + line.length + 1 > MAIN_LOG_MAX_BYTES) {
      rotate()
    }
    fs.appendFileSync(main, line + '\n', 'utf-8')
  } catch {
    // 落盘失败不影响缓冲与 stdout
  }
}

/** 轮转：main.log → main.1.log（覆盖旧 main.1.log，保持 1MB×2 上限） */
function rotate(): void {
  const main = path.join(logsDir, 'main.log')
  const prev = path.join(logsDir, 'main.1.log')
  try {
    if (fs.existsSync(prev)) fs.rmSync(prev)
    fs.renameSync(main, prev)
  } catch {
    // 轮转失败：继续追加 main.log（宁可超限也不丢日志）
  }
}

/** console 代理工厂：转发到缓冲/文件，同时保留原生 stdout 输出 */
function makeConsoleProxy(level: keyof typeof native): (...args: unknown[]) => void {
  return (...args: unknown[]) => {
    native[level](...args)
    push(level, argsToText(args))
  }
}

/**
 * 初始化日志层：必须在任何业务 console.* 之前调用（main.ts whenReady 首行）。
 * 重复调用幂等（仅首次安装劫持）。
 */
export function initLogger(userDataDir: string): void {
  if (initialized) return
  logsDir = path.join(userDataDir, 'logs')
  try {
    fs.mkdirSync(logsDir, { recursive: true })
  } catch {
    // 目录创建失败：仅缓冲模式（内存导出仍可用）
    logsDir = ''
  }
  initialized = true
  console.log = makeConsoleProxy('log')
  console.info = makeConsoleProxy('info')
  console.warn = makeConsoleProxy('warn')
  console.error = makeConsoleProxy('error')
  console.debug = makeConsoleProxy('debug')
  push('info', `[boot] SafeBox v${app.getVersion()} 启动（electron ${process.versions.electron}, ${process.platform} ${os.release()}）`)
}

/** 当前缓冲快照（测试/导出用，返回副本） */
export function getBuffer(): LogRecord[] {
  return [...buffer]
}

/**
 * 导出诊断日志：头部元信息 + 环形缓冲全量。
 * 缓冲即最近 ~500 条，足以覆盖「问题发生前」窗口；落盘文件可由用户直接压缩随反馈提交。
 */
export function exportDiagnostics(): string {
  const header = [
    `SafeBox 诊断日志（导出时间 ${new Date().toISOString()}）`,
    `版本: ${app.getVersion()} | Electron: ${process.versions.electron} | 平台: ${process.platform} ${os.release()}`,
    `缓冲记录: ${buffer.length} 条（上限 ${MAX_BUFFER}）`,
    '注：日志经脱敏处理，不含密码/PIN/TOTP/备份口令等敏感值。',
    '-'.repeat(60),
  ]
  return [...header, ...buffer.map(formatRecord)].join('\n') + '\n'
}

/** 重置日志层（仅测试用：卸载劫持、清空状态） */
export function resetLogger(): void {
  if (initialized) {
    console.log = native.log
    console.info = native.info
    console.warn = native.warn
    console.error = native.error
    console.debug = native.debug
  }
  buffer = []
  logsDir = ''
  initialized = false
}
