import { afterEach, describe, expect, it } from 'vitest'
import { getLang, resolveLang, setLang, t } from '../../src/renderer/src/lib/i18n'
import { zh } from '../../src/renderer/src/lib/locales/zh'
import { en } from '../../src/renderer/src/lib/locales/en'

/** 递归收集对象的全部叶子路径 */
function leafPaths(obj: Record<string, unknown>, prefix = ''): string[] {
  const paths: string[] = []
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (value !== null && typeof value === 'object') {
      paths.push(...leafPaths(value as Record<string, unknown>, path))
    } else {
      paths.push(path)
    }
  }
  return paths
}

afterEach(() => {
  setLang('zh')
})

describe('i18n 资源完整性（issue #33）', () => {
  it('en 与 zh 键结构完全一致（无缺失 key）', () => {
    const zhKeys = leafPaths(zh).sort()
    const enKeys = leafPaths(en).sort()
    expect(enKeys).toEqual(zhKeys)
  })

  it('所有叶子值均为非空字符串', () => {
    for (const catalog of [zh, en]) {
      const walk = (obj: Record<string, unknown>): void => {
        for (const value of Object.values(obj)) {
          if (value !== null && typeof value === 'object') walk(value as Record<string, unknown>)
          else expect(typeof value === 'string' && value.length > 0).toBe(true)
        }
      }
      walk(catalog)
    }
  })

  it('zh 与 en 的插值占位符一致', () => {
    const zhFlat = Object.fromEntries(leafPaths(zh).map((p) => [p, '']))
    for (const path of Object.keys(zhFlat)) {
      const get = (catalog: Record<string, unknown>): string => {
        let node: unknown = catalog
        for (const seg of path.split('.')) node = (node as Record<string, unknown>)[seg]
        return node as string
      }
      const zhVars = [...get(zh).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
      const enVars = [...get(en).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
      expect(enVars).toEqual(zhVars)
    }
  })
})

describe('i18n 查表与兜底', () => {
  it('默认语言 zh，t() 返回中文', () => {
    expect(getLang()).toBe('zh')
    expect(t('sidebar.allAccounts')).toBe('全部账号')
  })

  it('setLang(en) 后同 key 返回英文', () => {
    setLang('en')
    expect(t('sidebar.allAccounts')).toBe('All Accounts')
    expect(t('header.accountCount', { count: 3 })).toBe('3 accounts')
  })

  it('缺失 key 兜底为 key 本身（不出现空白）', () => {
    setLang('en')
    expect(t('totally.missing.key')).toBe('totally.missing.key')
    expect(t('')).toBe('')
  })

  it('插值替换 {name}，未提供的占位符原样保留', () => {
    expect(t('toast.lockEnabledHint')).toBe('锁定已启用，应用空闲或启动时将要求解锁')
    expect(t('confirm.deleteMsg', { title: 'GitHub' })).toContain('GitHub')
    expect(t('header.accountCount', { count: 5 })).toBe('5 个账号')
    expect(t('header.accountCount')).toBe('{count} 个账号')
  })
})

describe('resolveLang 语言解析', () => {
  it('显式 zh / en 直接采用', () => {
    expect(resolveLang('zh', 'en-US')).toBe('zh')
    expect(resolveLang('en', 'zh-CN')).toBe('en')
  })

  it('auto 按系统 locale：zh 前缀取中文，其余取英文', () => {
    expect(resolveLang('auto', 'zh-CN')).toBe('zh')
    expect(resolveLang('auto', 'zh-TW')).toBe('zh')
    expect(resolveLang('auto', 'en-US')).toBe('en')
    expect(resolveLang('auto', 'ja')).toBe('en')
    expect(resolveLang('auto', '')).toBe('en')
  })
})
