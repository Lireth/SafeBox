import { CATEGORIES, type FilterId } from './categories'
import { t } from './i18n'

/** 数字快捷键 → 筛选目标：Ctrl+1..8 切换分类，Ctrl+9 查看收藏 */
export function filterForDigit(digit: number): FilterId | null {
  if (digit === 9) return 'favorite'
  return CATEGORIES[digit - 1]?.id ?? null
}

/**
 * 快捷键说明（帮助弹窗数据源，与 App 键盘处理保持一致）。
 * 改为函数按当前语言求值（issue #33）：键位不变，说明文案走 t()。
 */
export function getHotkeyList(): Array<{ keys: string; desc: string }> {
  return [
    { keys: 'Ctrl + N', desc: t('hotkeys.newAccount') },
    { keys: 'Ctrl + F', desc: t('hotkeys.focusSearch') },
    { keys: 'Ctrl + L', desc: t('hotkeys.lockNow') },
    { keys: 'Ctrl + Alt + L', desc: t('hotkeys.globalLock') },
    { keys: 'Ctrl + 1 ~ 8', desc: t('hotkeys.switchCategory') },
    { keys: 'Ctrl + 9', desc: t('hotkeys.showFavorites') },
    { keys: '↑ / ↓', desc: t('hotkeys.navigateList') },
    { keys: 'Enter', desc: t('hotkeys.openSelected') },
    { keys: 'Esc', desc: t('hotkeys.escClose') },
    { keys: 'Ctrl + /', desc: t('hotkeys.showHelp') },
  ]
}
