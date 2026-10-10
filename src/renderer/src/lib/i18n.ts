import { useSyncExternalStore } from 'react'
import { zh } from './locales/zh'
import { en } from './locales/en'

/**
 * 轻量自研 i18n（issue #33）：语义 key + zh/en 资源查表，零第三方依赖。
 * - 默认语言 zh，缺失 key 逐级兜底：当前语言 → zh → key 本身（保证不出现空白）
 * - React 组件通过 useLang() 订阅语言变化触发重渲染；纯逻辑 lib 直接调用 t()
 *   （节点测试环境未 bootstrap，current 恒为 zh，故既有断言中文串的测试保持通过）
 * - 语言检测：App 启动读取 settings.language（auto/zh/en），auto 时用系统 locale（app.getLocale 经 IPC）
 */

export type Lang = 'zh' | 'en'

type Catalog = Record<string, unknown>

const CATALOGS: Record<Lang, Catalog> = { zh, en }

let current: Lang = 'zh'
const listeners = new Set<() => void>()

export function getLang(): Lang {
  return current
}

/**
 * 由设置项与系统 locale 解析有效语言（issue #33）。
 * auto：系统 locale 以 zh 开头取 zh，否则 en；显式 zh/en 直接采用。
 */
export function resolveLang(setting: 'auto' | Lang, systemLocale: string): Lang {
  if (setting === 'zh' || setting === 'en') return setting
  return systemLocale.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

export function setLang(lang: Lang): void {
  if (lang === current) return
  current = lang
  for (const fn of listeners) fn()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** React Hook：订阅当前语言，语言切换时组件重渲染 */
export function useLang(): Lang {
  return useSyncExternalStore(subscribe, getLang, getLang)
}

/** 按点分路径在嵌套资源中查值；未命中返回 undefined */
function lookup(catalog: Catalog, path: string): string | undefined {
  let node: unknown = catalog
  for (const seg of path.split('.')) {
    if (node === null || typeof node !== 'object') return undefined
    node = (node as Record<string, unknown>)[seg]
  }
  return typeof node === 'string' ? node : undefined
}

/** 插值：把 {name} 替换为 vars.name */
function interpolate(text: string, vars?: Record<string, string | number | undefined>): string {
  if (!vars) return text
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars && vars[k] !== undefined ? String(vars[k]) : m))
}

/**
 * 翻译：当前语言 → zh 兜底 → key 兜底。
 * @param key 点分路径，如 'sidebar.allAccounts'
 * @param vars 插值变量，如 { count: 5 }
 */
export function t(key: string, vars?: Record<string, string | number | undefined>): string {
  const raw = lookup(CATALOGS[current], key) ?? lookup(CATALOGS.zh, key) ?? key
  return interpolate(raw, vars)
}
