import { CATEGORIES, type FilterId } from './categories'

/** 数字快捷键 → 筛选目标：Ctrl+1..8 切换分类，Ctrl+9 查看收藏 */
export function filterForDigit(digit: number): FilterId | null {
  if (digit === 9) return 'favorite'
  return CATEGORIES[digit - 1]?.id ?? null
}

/** 快捷键说明（帮助弹窗数据源，与 App 键盘处理保持一致） */
export const HOTKEY_LIST: Array<{ keys: string; desc: string }> = [
  { keys: 'Ctrl + N', desc: '新建账号' },
  { keys: 'Ctrl + F', desc: '聚焦搜索框' },
  { keys: 'Ctrl + L', desc: '立即锁定（需已启用锁定）' },
  { keys: 'Ctrl + Alt + L', desc: '全局锁定（焦点在任意应用时均生效）' },
  { keys: 'Ctrl + 1 ~ 8', desc: '切换到对应分类' },
  { keys: 'Ctrl + 9', desc: '查看收藏' },
  { keys: '↑ / ↓', desc: '在账号列表中导航' },
  { keys: 'Enter', desc: '打开选中的账号' },
  { keys: 'Esc', desc: '关闭弹窗 / 清空搜索' },
  { keys: 'Ctrl + /', desc: '显示本帮助' },
]
