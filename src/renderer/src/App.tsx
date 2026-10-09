import { useEffect, useMemo, useRef, useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { EntryRow } from './components/EntryRow'
import { EntryFormModal } from './components/EntryFormModal'
import { EntryDetailModal } from './components/EntryDetailModal'
import { ConfirmModal } from './components/ConfirmModal'
import { TrashRow } from './components/TrashRow'
import { LockScreen } from './components/LockScreen'
import { PinSetupModal } from './components/PinSetupModal'
import { BackupModal } from './components/BackupModal'
import { AuditModal } from './components/AuditModal'
import { HotkeyHelpModal } from './components/HotkeyHelpModal'
import { Icon } from './components/Icon'
import { getCategory, type FilterId } from './lib/categories'
import { filterForDigit } from './lib/hotkeys'
import type { AccountEntry, BackupExportResult, BackupImportResult, EntryDraft } from '../../../shared/types'

interface FormTarget {
  mode: 'new' | 'edit'
  entry: AccountEntry | null
}

interface ToastState {
  type: 'success' | 'error'
  message: string
}

interface LoadWarning {
  title: string
  detail: string
}

/** 错误消息提取：IPC 报错还原主进程真实信息 */
function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback
}

export default function App(): React.JSX.Element {
  const [ready, setReady] = useState(false)
  const [entries, setEntries] = useState<AccountEntry[]>([])
  /** 非 null 表示数据文件异常（整体损坏或含坏条目），展示持久警示条 */
  const [loadWarning, setLoadWarning] = useState<LoadWarning | null>(null)
  const [locked, setLocked] = useState(false)
  const [pinEnabled, setPinEnabled] = useState(false)
  const [pinModalOpen, setPinModalOpen] = useState(false)
  const [backupModalOpen, setBackupModalOpen] = useState(false)
  const [auditOpen, setAuditOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  /** 非 null 表示新版本已下载就绪（值为版本号） */
  const [updateVersion, setUpdateVersion] = useState<string | null>(null)
  const [updateBannerDismissed, setUpdateBannerDismissed] = useState(false)
  /** 键盘导航在列表中的当前位置（-1 表示未选中） */
  const [activeIndex, setActiveIndex] = useState(-1)
  const [filter, setFilter] = useState<FilterId>('all')
  const [query, setQuery] = useState('')
  const [formTarget, setFormTarget] = useState<FormTarget | null>(null)
  const [detailEntry, setDetailEntry] = useState<AccountEntry | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AccountEntry | null>(null)
  /** 待彻底删除的条目（回收站内操作，物理删除不可恢复） */
  const [purgeTarget, setPurgeTarget] = useState<AccountEntry | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)

  // 启动即加载账号数据与加载状态
  useEffect(() => {
    let cancelled = false
    void window.safebox
      .listEntries()
      .then((list) => {
        if (!cancelled) {
          setEntries(list)
          setReady(true)
        }
      })
      .catch(() => {
        if (!cancelled) setReady(true)
      })
    void window.safebox
      .getLoadStatus()
      .then((status) => {
        if (cancelled) return
        if (status.status === 'broken' && status.backupFile) {
          // 生产环境留痕：数据异常必须在日志可见
          console.error(`[SafeBox] 数据文件解析失败，已自动备份为 ${status.backupFile}`)
          setLoadWarning({
            title: '数据文件解析失败',
            detail: `已自动备份为 ${status.backupFile}，当前从空数据开始。请先在数据目录中处理备份文件，勿直接重新录入。`,
          })
        } else if (status.status === 'repaired') {
          console.error(`[SafeBox] 数据文件含 ${status.skipped ?? 0} 条损坏条目，已自动跳过`)
          setLoadWarning({
            title: '部分账号数据损坏',
            detail: `已自动跳过 ${status.skipped ?? 0} 条格式损坏的账号，其余账号可正常访问。如发现有账号缺失，请检查数据目录中的历史备份。`,
          })
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // 锁定状态：启动查询 + 订阅主进程广播
  useEffect(() => {
    let cancelled = false
    void window.safebox
      .getLockState()
      .then((state) => {
        if (cancelled) return
        setPinEnabled(state.pinEnabled)
        setLocked(state.locked)
        if (state.locked) {
          // 启动即锁定：确保渲染端不持有任何条目
          setEntries([])
          setReady(true)
        }
      })
      .catch(() => {})
    const off = window.safebox.onLockChanged((isLocked) => {
      if (isLocked) {
        // 清空渲染端内存中的敏感数据，关闭所有可能展示内容的弹窗
        setLocked(true)
        setEntries([])
        setDetailEntry(null)
        setDeleteTarget(null)
        setFormTarget(null)
      } else {
        setLocked(false)
        void refetchEntries()
      }
    })
    // 订阅自动更新就绪事件
    const offUpdate = window.safebox.onUpdateReady((info) => {
      setUpdateVersion(info.version)
    })
    return () => {
      cancelled = true
      off()
      offUpdate()
    }
  }, [])

  // Ctrl+L 手动锁定（已启用 PIN 且未锁定时）
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.ctrlKey && (e.key === 'l' || e.key === 'L')) {
        e.preventDefault()
        if (pinEnabled && !locked) void window.safebox.lockNow()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pinEnabled, locked])

  /** 解锁 / 初始加载后拉取账号列表 */
  async function refetchEntries(): Promise<void> {
    try {
      const list = await window.safebox.listEntries()
      setEntries(list)
    } catch {
      // 锁定等场景下由对应流程处理
    }
  }

  function showToast(message: string, type: 'success' | 'error' = 'success'): void {
    window.clearTimeout(toastTimer.current)
    setToast({ type, message })
    toastTimer.current = window.setTimeout(() => setToast(null), 1800)
  }

  // 当前筛选下可见的账号：收藏优先，其余按更新时间倒序；回收站按删除时间倒序
  const activeEntries = useMemo(() => entries.filter((e) => !e.deletedAt), [entries])
  const trashEntries = useMemo(() => entries.filter((e) => !!e.deletedAt), [entries])
  const visibleEntries = useMemo(() => {
    const q = query.trim().toLowerCase()
    const source = filter === 'trash' ? trashEntries : activeEntries
    return source
      .filter((e) =>
        filter === 'all' || filter === 'trash' ? true : filter === 'favorite' ? e.favorite : e.category === filter,
      )
      .filter((e) => (q ? [e.title, e.username, e.url, e.notes].some((f) => f.toLowerCase().includes(q)) : true))
      .sort((a, b) =>
        filter === 'trash'
          ? (b.deletedAt ?? 0) - (a.deletedAt ?? 0)
          : Number(b.favorite) - Number(a.favorite) || b.updatedAt - a.updatedAt,
      )
  }, [activeEntries, trashEntries, filter, query])

  const headerLabel = filter === 'all' ? '全部账号' : filter === 'favorite' ? '收藏' : filter === 'trash' ? '回收站' : getCategory(filter).label

  // 全局快捷键与键盘导航（弹窗打开或锁定期间不响应）
  useEffect(() => {
    const anyModalOpen =
      !!formTarget || !!detailEntry || !!deleteTarget || !!purgeTarget || pinModalOpen || backupModalOpen || auditOpen || helpOpen
    const interactionBlocked = anyModalOpen || locked || !ready

    function onKey(e: KeyboardEvent): void {
      const target = e.target as HTMLElement | null
      const inEditable =
        !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)

      // ---- Ctrl 组合键（输入框聚焦时同样生效） ----
      if (e.ctrlKey && !interactionBlocked) {
        if (e.key === 'n' || e.key === 'N') {
          e.preventDefault()
          setActiveIndex(-1)
          setFormTarget({ mode: 'new', entry: null })
          return
        }
        if (e.key === 'f' || e.key === 'F') {
          e.preventDefault()
          document.getElementById('search-input')?.focus()
          return
        }
        if (e.key === '/') {
          e.preventDefault()
          setHelpOpen(true)
          return
        }
        if (/^[1-9]$/.test(e.key)) {
          e.preventDefault()
          const filterId = filterForDigit(Number(e.key))
          if (filterId) {
            setFilter(filterId)
            setActiveIndex(-1)
          }
          return
        }
        return
      }

      // ---- Esc：无弹窗时清空搜索 ----
      if (e.key === 'Escape') {
        if (!anyModalOpen && query) {
          setQuery('')
          setActiveIndex(-1)
        }
        return
      }

      // ---- 列表导航（仅在非输入框聚焦时；回收站条目不可打开，禁用导航） ----
      if (inEditable || interactionBlocked || filter === 'trash') return
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIndex((prev) => {
          const len = visibleEntries.length
          if (len === 0) return -1
          if (prev === -1) return e.key === 'ArrowDown' ? 0 : len - 1
          return Math.min(Math.max(prev + (e.key === 'ArrowDown' ? 1 : -1), 0), len - 1)
        })
      } else if (e.key === 'Enter' && activeIndex >= 0 && visibleEntries[activeIndex]) {
        e.preventDefault()
        setDetailEntry(visibleEntries[activeIndex])
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    formTarget,
    detailEntry,
    deleteTarget,
    purgeTarget,
    pinModalOpen,
    backupModalOpen,
    auditOpen,
    helpOpen,
    locked,
    ready,
    visibleEntries,
    activeIndex,
    filter,
    query,
  ])

  // 筛选或搜索变化时重置键盘导航位置（渲染期调整状态，避免 effect 级联渲染）
  const [prevNavKey, setPrevNavKey] = useState('')
  const navKey = `${filter}|${query}`
  if (prevNavKey !== navKey) {
    setPrevNavKey(navKey)
    setActiveIndex(-1)
  }

  // ---- 动作 ----

  async function handleSubmitForm(draft: EntryDraft): Promise<void> {
    if (!formTarget) return
    if (formTarget.mode === 'new') {
      const created = await window.safebox.addEntry(draft)
      setEntries((prev) => [...prev, created])
      setFilter((f) => (f === 'all' || f === 'favorite' || f === created.category ? f : created.category))
      showToast('账号已添加')
    } else if (formTarget.entry) {
      const updated = await window.safebox.updateEntry(formTarget.entry.id, draft)
      setEntries((prev) => prev.map((e) => (e.id === updated.id ? updated : e)))
      setDetailEntry((cur) => (cur?.id === updated.id ? updated : cur))
      showToast('修改已保存')
    }
    setFormTarget(null)
  }

  async function handleConfirmDelete(): Promise<void> {
    if (!deleteTarget) return
    const id = deleteTarget.id
    try {
      await window.safebox.deleteEntry(id)
      setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, deletedAt: Date.now() } : e)))
      setDetailEntry((cur) => (cur?.id === id ? null : cur))
      setDeleteTarget(null)
      showToast('已移入回收站，30 天内可恢复')
    } catch (err) {
      showToast(errorMessage(err, '删除失败'), 'error')
    }
  }

  /** 从回收站恢复条目（清除软删除标记） */
  async function handleRestore(entry: AccountEntry): Promise<void> {
    try {
      const restored = await window.safebox.restoreEntry(entry.id)
      setEntries((prev) => prev.map((e) => (e.id === restored.id ? restored : e)))
      showToast('账号已恢复')
    } catch (err) {
      showToast(errorMessage(err, '恢复失败'), 'error')
    }
  }

  /** 彻底删除回收站中的条目（物理删除，不可恢复） */
  async function handleConfirmPurge(): Promise<void> {
    if (!purgeTarget) return
    const id = purgeTarget.id
    try {
      await window.safebox.purgeEntry(id)
      setEntries((prev) => prev.filter((e) => e.id !== id))
      setPurgeTarget(null)
      showToast('已彻底删除')
    } catch (err) {
      showToast(errorMessage(err, '删除失败'), 'error')
    }
  }

  async function handleToggleFavorite(entry: AccountEntry): Promise<void> {
    try {
      const updated = await window.safebox.toggleFavorite(entry.id)
      setEntries((prev) => prev.map((e) => (e.id === updated.id ? updated : e)))
      setDetailEntry((cur) => (cur?.id === updated.id ? updated : cur))
    } catch (err) {
      showToast(errorMessage(err, '操作失败'), 'error')
    }
  }

  function handleCopy(text: string, message: string): void {
    window.safebox
      .copyText(text)
      .then(() => showToast(message))
      .catch((err) => showToast(errorMessage(err, '复制失败'), 'error'))
  }

  async function handleLockNow(): Promise<void> {
    try {
      await window.safebox.lockNow()
    } catch (err) {
      showToast(errorMessage(err, '锁定失败'), 'error')
    }
  }

  async function handleSetupPin(oldPin: string | undefined, newPin: string): Promise<void> {
    await window.safebox.setupLockPin(oldPin, newPin)
    setPinEnabled(true)
    showToast('锁定已启用，应用空闲或启动时将要求解锁')
  }

  async function handleClearPin(oldPin: string): Promise<void> {
    await window.safebox.clearLockPin(oldPin)
    setPinEnabled(false)
    showToast('锁定已清除')
  }

  async function handleExportBackup(password: string): Promise<BackupExportResult> {
    const result = await window.safebox.exportEncryptedBackup(password)
    return result
  }

  async function handleImportBackup(password: string): Promise<BackupImportResult> {
    const result = await window.safebox.importEncryptedBackup(password)
    if (!result.canceled) await refetchEntries()
    return result
  }

  // ---- 渲染 ----

  if (!ready) {
    return (
      <div className="boot-screen">
        <div className="spinner" />
      </div>
    )
  }

  return (
    <div className="app">
      {locked && <LockScreen onSubmit={(pin) => window.safebox.unlockApp(pin)} />}

      <Sidebar
        entries={activeEntries}
        trashCount={trashEntries.length}
        filter={filter}
        query={query}
        pinEnabled={pinEnabled}
        onFilterChange={setFilter}
        onQueryChange={setQuery}
        onAdd={() => setFormTarget({ mode: 'new', entry: null })}
        onLock={() => void handleLockNow()}
        onSetupPin={() => setPinModalOpen(true)}
        onBackup={() => setBackupModalOpen(true)}
        onAudit={() => setAuditOpen(true)}
      />

      <main className="main">
        {updateVersion && !updateBannerDismissed && !locked && (
          <div className="update-banner" role="status">
            <Icon name="download" size={15} className="update-banner-icon" />
            <span className="update-banner-text">新版本 v{updateVersion} 已就绪，将随下次启动自动安装。</span>
            <button
              type="button"
              className="btn btn-ghost update-banner-action"
              onClick={() => void window.safebox.installUpdate()}
            >
              立即重启更新
            </button>
            <button type="button" className="icon-btn" aria-label="关闭提示" onClick={() => setUpdateBannerDismissed(true)}>
              <Icon name="x" size={14} />
            </button>
          </div>
        )}

        {loadWarning && (
          <div className="load-warning" role="alert">
            <Icon name="alert-triangle" size={18} className="load-warning-icon" />
            <div className="load-warning-text">
              <strong>{loadWarning.title}</strong>
              <span>{loadWarning.detail}</span>
            </div>
            <button
              type="button"
              className="btn btn-ghost load-warning-action"
              onClick={() => void window.safebox.openDataDir()}
            >
              打开数据目录
            </button>
            <button type="button" className="icon-btn" aria-label="关闭警示" onClick={() => setLoadWarning(null)}>
              <Icon name="x" size={14} />
            </button>
          </div>
        )}

        <header className="main-header">
          <div className="main-heading">
            <h1 className="main-title">{headerLabel}</h1>
            <span className="main-count">{visibleEntries.length} 个账号</span>
          </div>
          <div className="main-heading-actions">
            <button type="button" className="icon-btn" title="快捷键说明（Ctrl+/）" onClick={() => setHelpOpen(true)}>
              <Icon name="keyboard" size={16} />
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setFormTarget({ mode: 'new', entry: null })}
            >
              <Icon name="plus" size={16} />
              添加账号
            </button>
          </div>
        </header>

        <div className="entry-list">
          {filter === 'trash' ? (
            visibleEntries.length === 0 ? (
              <div className="empty-state slim">
                <div className="empty-icon">
                  <Icon name="trash" size={26} strokeWidth={1.5} />
                </div>
                <h2>回收站是空的</h2>
                <p>删除的账号会在这里保留 30 天，期间可随时恢复</p>
              </div>
            ) : (
              visibleEntries.map((entry, index) => (
                <TrashRow
                  key={entry.id}
                  entry={entry}
                  isActive={index === activeIndex}
                  onRestore={(e) => void handleRestore(e)}
                  onPurge={setPurgeTarget}
                />
              ))
            )
          ) : activeEntries.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">
                <Icon name="inbox" size={34} strokeWidth={1.5} />
              </div>
              <h2>还没有保存任何账号</h2>
              <p>添加您的第一个账号，数据将加密保存在本机</p>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setFormTarget({ mode: 'new', entry: null })}
              >
                <Icon name="plus" size={16} />
                添加账号
              </button>
            </div>
          ) : visibleEntries.length === 0 ? (
            <div className="empty-state slim">
              <div className="empty-icon">
                <Icon name="search" size={26} strokeWidth={1.5} />
              </div>
              <h2>没有匹配的账号</h2>
              <p>换个关键词或切换分类试试</p>
            </div>
          ) : (
            visibleEntries.map((entry, index) => (
              <EntryRow
                key={entry.id}
                entry={entry}
                isActive={index === activeIndex}
                onOpen={setDetailEntry}
                onToggleFavorite={(e) => void handleToggleFavorite(e)}
                onCopy={handleCopy}
              />
            ))
          )}
        </div>
      </main>

      {formTarget && (
        <EntryFormModal
          entry={formTarget.mode === 'edit' ? formTarget.entry : null}
          onClose={() => setFormTarget(null)}
          onSubmit={handleSubmitForm}
        />
      )}

      {detailEntry && !formTarget && (
        <EntryDetailModal
          entry={detailEntry}
          onClose={() => setDetailEntry(null)}
          onEdit={(entry) => setFormTarget({ mode: 'edit', entry })}
          onDelete={setDeleteTarget}
          onToggleFavorite={(e) => void handleToggleFavorite(e)}
          onCopy={handleCopy}
        />
      )}

      {deleteTarget && (
        <ConfirmModal
          title="删除账号"
          message={`确定要删除「${deleteTarget.title}」吗？删除后将移入回收站，30 天内可恢复。`}
          onConfirm={() => void handleConfirmDelete()}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {purgeTarget && (
        <ConfirmModal
          title="彻底删除"
          message={`确定要彻底删除「${purgeTarget.title}」吗？彻底删除后无法恢复。`}
          onConfirm={() => void handleConfirmPurge()}
          onCancel={() => setPurgeTarget(null)}
        />
      )}

      {pinModalOpen && (
        <PinSetupModal
          pinEnabled={pinEnabled}
          onClose={() => setPinModalOpen(false)}
          onSetup={handleSetupPin}
          onClear={handleClearPin}
        />
      )}

      {backupModalOpen && (
        <BackupModal
          onClose={() => setBackupModalOpen(false)}
          onExport={handleExportBackup}
          onImport={handleImportBackup}
        />
      )}

      {auditOpen && (
        <AuditModal
          entries={activeEntries}
          onClose={() => setAuditOpen(false)}
          onEdit={(entry) => {
            setAuditOpen(false)
            setFormTarget({ mode: 'edit', entry })
          }}
        />
      )}

      {helpOpen && <HotkeyHelpModal onClose={() => setHelpOpen(false)} />}

      {toast && (
        <div className={`toast ${toast.type === 'error' ? 'toast-error' : ''}`} role="status">
          <Icon name={toast.type === 'error' ? 'alert-triangle' : 'check'} size={14} />
          {toast.message}
        </div>
      )}
    </div>
  )
}
