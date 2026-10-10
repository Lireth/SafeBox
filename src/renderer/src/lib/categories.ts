import type { IconName } from '../components/Icon'
import { t } from './i18n'

/**
 * 分类定义：id 与主进程 vault.ts 的 CATEGORY_IDS 保持一致。
 * label 为 getter，每次访问按当前语言求值（issue #33），语言切换后随组件重渲染更新。
 */
export interface CategoryDef {
  id: string
  /** 用于头像/标识的色相值（hsl） */
  hue: number
  icon: IconName
  readonly label: string
}

function makeCategory(id: string, icon: IconName, hue: number): CategoryDef {
  return {
    id,
    icon,
    hue,
    get label(): string {
      return t(`categories.${id}`)
    },
  }
}

export const CATEGORIES: CategoryDef[] = [
  makeCategory('dev', 'code', 235),
  makeCategory('social', 'chat', 330),
  makeCategory('email', 'mail', 200),
  makeCategory('finance', 'bank', 152),
  makeCategory('shopping', 'cart', 28),
  makeCategory('work', 'briefcase', 260),
  makeCategory('study', 'book', 95),
  makeCategory('other', 'folder', 210),
]

const CATEGORY_MAP = new Map(CATEGORIES.map((c) => [c.id, c]))

export function getCategory(id: string): CategoryDef {
  return CATEGORY_MAP.get(id) ?? CATEGORIES[CATEGORIES.length - 1]
}

/**
 * 侧栏筛选值：'all'（全部账号）/ 'favorite'（收藏）/ 任意分类 id。
 * 因分类 id 具备扩展性，此类型以 string 为基础；
 * 字面量 'all' / 'favorite' 仅为可读性文档，请使用 lib 常量判断。
 */
export type FilterId = string
