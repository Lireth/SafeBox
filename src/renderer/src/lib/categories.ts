import type { IconName } from '../components/Icon'

/** 分类定义：id 与主进程 vault.ts 的 CATEGORY_IDS 保持一致 */
export interface CategoryDef {
  id: string
  label: string
  icon: IconName
  /** 用于头像/标识的色相值（hsl） */
  hue: number
}

export const CATEGORIES: CategoryDef[] = [
  { id: 'dev', label: '开发', icon: 'code', hue: 235 },
  { id: 'social', label: '社交', icon: 'chat', hue: 330 },
  { id: 'email', label: '邮箱', icon: 'mail', hue: 200 },
  { id: 'finance', label: '金融', icon: 'bank', hue: 152 },
  { id: 'shopping', label: '购物', icon: 'cart', hue: 28 },
  { id: 'work', label: '工作', icon: 'briefcase', hue: 260 },
  { id: 'study', label: '学习', icon: 'book', hue: 95 },
  { id: 'other', label: '其他', icon: 'folder', hue: 210 },
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
