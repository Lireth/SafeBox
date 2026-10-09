import { useEffect, useMemo, useRef, useState } from 'react'
import { Modal } from './Modal'
import { Icon } from './Icon'
import { CATEGORIES } from '../lib/categories'
import { generatePassword, passwordStrength } from '../lib/password'
import type { AccountEntry, EntryDraft } from '../../../../shared/types'

interface EntryFormModalProps {
  /** null = 新增，否则为编辑的原始记录 */
  entry: AccountEntry | null
  onClose: () => void
  onSubmit: (draft: EntryDraft) => Promise<void>
}

const EMPTY_FORM: EntryDraft = {
  title: '',
  category: 'other',
  url: '',
  username: '',
  password: '',
  notes: '',
  favorite: false
}

const DEFAULT_GENERATOR = { length: 16, upper: true, lower: true, digits: true, symbols: true }

export function EntryFormModal({ entry, onClose, onSubmit }: EntryFormModalProps): React.JSX.Element {
  const [form, setForm] = useState<EntryDraft>(entry ?? EMPTY_FORM)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [genOpen, setGenOpen] = useState(false)
  const [genOptions, setGenOptions] = useState(DEFAULT_GENERATOR)
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    titleRef.current?.focus()
  }, [])

  const strength = useMemo(() => passwordStrength(form.password), [form.password])
  const canSubmit = form.title.trim().length > 0 && !busy

  function patch(partial: Partial<EntryDraft>): void {
    setForm((prev) => ({ ...prev, ...partial }))
  }

  function handleGenerate(): void {
    patch({ password: generatePassword(genOptions) })
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (!canSubmit) return
    setBusy(true)
    setError('')
    try {
      await onSubmit({ ...form, title: form.title.trim() })
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
      setBusy(false)
    }
  }

  return (
    <Modal title={entry ? '编辑账号' : '添加账号'} onClose={onClose}>
      <form onSubmit={(e) => void handleSubmit(e)}>
        <label className="field-label" htmlFor="entry-title">
          名称 <span className="required">*</span>
        </label>
        <input
          ref={titleRef}
          id="entry-title"
          className="input"
          type="text"
          placeholder="如：GitHub、公司邮箱"
          value={form.title}
          onChange={(e) => patch({ title: e.target.value })}
        />

        <span className="field-label">分类</span>
        <div className="chip-group">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              type="button"
              className={`chip ${form.category === cat.id ? 'active' : ''}`}
              onClick={() => patch({ category: cat.id })}
            >
              <Icon name={cat.icon} size={13} />
              {cat.label}
            </button>
          ))}
        </div>

        <label className="field-label" htmlFor="entry-url">
          网址
        </label>
        <input
          id="entry-url"
          className="input"
          type="text"
          placeholder="https://example.com"
          value={form.url}
          onChange={(e) => patch({ url: e.target.value })}
        />

        <label className="field-label" htmlFor="entry-username">
          用户名 / 邮箱 / 手机号
        </label>
        <input
          id="entry-username"
          className="input"
          type="text"
          placeholder="登录账号"
          value={form.username}
          onChange={(e) => patch({ username: e.target.value })}
        />

        <div className="field-row">
          <label className="field-label" htmlFor="entry-password">
            密码
          </label>
          <button
            type="button"
            className="text-btn"
            onClick={() => {
              if (!genOpen) handleGenerate()
              setGenOpen((v) => !v)
            }}
          >
            <Icon name="refresh" size={13} />
            {genOpen ? '收起生成器' : '生成密码'}
          </button>
        </div>
        <div className="password-input-wrap">
          <input
            id="entry-password"
            className="input"
            type={showPassword ? 'text' : 'password'}
            placeholder="输入或生成密码"
            value={form.password}
            onChange={(e) => patch({ password: e.target.value })}
          />
          <button
            type="button"
            className="input-suffix"
            aria-label={showPassword ? '隐藏密码' : '显示密码'}
            onClick={() => setShowPassword((v) => !v)}
          >
            <Icon name={showPassword ? 'eye-off' : 'eye'} size={16} />
          </button>
        </div>
        {form.password && (
          <div className="strength">
            <div className="strength-bars">
              {[1, 2, 3, 4].map((i) => (
                <span key={i} className={`strength-bar s${strength.score} ${i <= strength.score ? 'on' : ''}`} />
              ))}
            </div>
            <span className="strength-label">{strength.label}</span>
          </div>
        )}

        {genOpen && (
          <div className="generator">
            <div className="field-row">
              <span className="field-label">长度：{genOptions.length}</span>
              <button type="button" className="text-btn" onClick={handleGenerate}>
                <Icon name="refresh" size={13} />
                重新生成
              </button>
            </div>
            <input
              type="range"
              min={8}
              max={64}
              className="range"
              value={genOptions.length}
              onChange={(e) => {
                const next = { ...genOptions, length: Number(e.target.value) }
                setGenOptions(next)
                patch({ password: generatePassword(next) })
              }}
            />
            <div className="checkbox-group">
              {(
                [
                  ['upper', '大写字母 A-Z'],
                  ['lower', '小写字母 a-z'],
                  ['digits', '数字 0-9'],
                  ['symbols', '符号 !@#']
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="checkbox">
                  <input
                    type="checkbox"
                    checked={genOptions[key]}
                    onChange={(e) => {
                      const next = { ...genOptions, [key]: e.target.checked }
                      setGenOptions(next)
                      // 调整字符类型后立即重新生成
                      patch({ password: generatePassword(next) })
                    }}
                  />
                  {label}
                </label>
              ))}
            </div>
            <p className="gen-hint">生成结果已写入上方密码框，可点击眼睛图标查看</p>
          </div>
        )}

        <label className="field-label" htmlFor="entry-notes">
          备注
        </label>
        <textarea
          id="entry-notes"
          className="input textarea"
          rows={3}
          placeholder="安全提示问题、绑定手机等备注信息"
          value={form.notes}
          onChange={(e) => patch({ notes: e.target.value })}
        />

        <label className="checkbox favorite-checkbox">
          <input type="checkbox" checked={form.favorite === true} onChange={(e) => patch({ favorite: e.target.checked })} />
          <Icon name="star" size={14} filled />
          收藏此账号
        </label>

        {error && <p className="form-error">{error}</p>}

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
            {entry ? '保存修改' : '添加'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
