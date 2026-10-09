import { useEffect, useMemo, useRef, useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { EntryRow } from './components/EntryRow'
import { EntryFormModal } from './components/EntryFormModal'
import { EntryDetailModal } from './components/EntryDetailModal'
import { ConfirmModal } from './components/ConfirmModal'
import { LockScreen } from './components/LockScreen'
import { PinSetupModal } from './components/PinSetupModal'
import { Icon } from './components/Icon'
import { getCategory, type FilterId } from './lib/categories'
import type { AccountEntry, EntryDraft } from '../../../shared/types'

interface FormTarget {
  mode: 'new' | 'edit'
  entry: AccountEntry | null
}

interface ToastState {
  type: 'success' | 'error'
  message: string
}

/** 错误消息提取：IPC 报错还原主进程真实信息 */
function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback
}

export default function App(): React.JSX.Element {
  const [ready, setReady] = useState(false)
  const [entries, setEntries] = useState<AccountEntry[]>([])
  /** 非 null 表示数据文件损坏已备份，展示持久警示条（值为备份文件名） */
  const [loadWarning, setLoadWarning] = useState<string | null>(null)
  const [locked, setLocked] = useState(false)
  const [pinEnabled, setPinEnabled] = useState(false)
  const [pinModalOpen, setPinModalOpen] = useState(false)
  const [filter, setFilter] = useState<FilterId>('all')
  const [query, setQuery] = useState('')
  const [formTarget, setFormTarget] = useState<FormTarget | null>(null)
  const [detailEntry, setDetailEntry] = useState<AccountEntry | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AccountEntry | null>(null)
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
          setLoadWarning(status.backupFile)
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
    return () => {
      cancelled = true
      off()
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

  // 当前筛选下可见的账号：收藏优先，其余按更新时间倒序
  const visibleEntries = useMemo(() => {
    const q = query.trim().toLowerCase()
    return entries
      .filter((e) =>
        filter === 'all' ? true : filter === 'favorite' ? e.favorite : e.category === filter
      )
      .filter((e) =>
        q ? [e.title, e.username, e.url, e.notes].some((f) => f.toLowerCase().includes(q)) : true
      )
      .sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.updatedAt - a.updatedAt)
  }, [entries, filter, query])

  const headerLabel =
    filter === 'all' ? '全部账号' : filter === 'favorite' ? '收藏' : getCategory(filter).label

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
      setEntries((prev) => prev.filter((e) => e.id !== id))
      setDetailEntry((cur) => (cur?.id === id ? null : cur))
      setDeleteTarget(null)
      showToast('账号已删除')
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
        entries={entries}
        filter={filter}
        query={query}
        pinEnabled={pinEnabled}
        onFilterChange={setFilter}
        onQueryChange={setQuery}
        onAdd={() => setFormTarget({ mode: 'new', entry: null })}
        onLock={() => void handleLockNow()}
        onSetupPin={() => setPinModalOpen(true)}
      />

      <main className="main">
        {loadWarning && (
          <div className="load-warning" role="alert">
            <Icon name="alert-triangle" size={18} className="load-warning-icon" />
            <div className="load-warning-text">
              <strong>数据文件解析失败</strong>
              <span>
                已自动备份为 {loadWarning}，当前从空数据开始。请先在数据目录中处理备份文件，勿直接重新录入。
              </span>
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
          <button type="button" className="btn btn-primary" onClick={() => setFormTarget({ mode: 'new', entry: null })}>
            <Icon name="plus" size={16} />
            添加账号
          </button>
        </header>

        <div className="entry-list">
          {entries.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">
                <Icon name="inbox" size={34} strokeWidth={1.5} />
              </div>
              <h2>还没有保存任何账号</h2>
              <p>添加您的第一个账号，数据将加密保存在本机</p>
              <button type="button" className="btn btn-primary" onClick={() => setFormTarget({ mode: 'new', entry: null })}>
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
            visibleEntries.map((entry) => (
              <EntryRow
                key={entry.id}
                entry={entry}
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
          message={`确定要删除「${deleteTarget.title}」吗？删除后无法恢复。`}
          onConfirm={() => void handleConfirmDelete()}
          onCancel={() => setDeleteTarget(null)}
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

      {toast && (
        <div className={`toast ${toast.type === 'error' ? 'toast-error' : ''}`} role="status">
          <Icon name={toast.type === 'error' ? 'alert-triangle' : 'check'} size={14} />
          {toast.message}
        </div>
      )}
    </div>
  )
}
