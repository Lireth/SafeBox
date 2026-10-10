import { useEffect, useMemo, useRef, useState } from 'react'
import { Modal } from './Modal'
import { Icon } from './Icon'
import { PasswordGenerator, type GeneratorMode } from './PasswordGenerator'
import { CATEGORIES } from '../lib/categories'
import { DEFAULT_PASSPHRASE, generatePassphrase, generatePassword, passwordStrength } from '../lib/password'
import { buildOtpauthUrl, parseTotpParams } from '../lib/totp'
import { t, useLang } from '../lib/i18n'
import { resolveIpcError } from '../lib/ipcError'
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
  favorite: false,
  totpSecret: '',
}

const DEFAULT_GENERATOR = { length: 16, upper: true, lower: true, digits: true, symbols: true }

/** 生成器模式（F20）：随机字符 / 口令短语；口令短语选项独立记忆 */
const DEFAULT_PASS_GENERATOR = DEFAULT_PASSPHRASE

export function EntryFormModal({ entry, onClose, onSubmit }: EntryFormModalProps): React.JSX.Element {
  useLang()
  // 编辑时 TOTP 字段回填重建的原始输入：带自定义参数的条目还原为 otpauth 链接，
  // 提交后主进程可重新解析出 period/digits/algorithm（F18，避免编辑丢失参数）；
  // 全默认参数保持裸 Base32（与历史行为一致）
  const [form, setForm] = useState<EntryDraft>(() =>
    entry && entry.totpSecret ? { ...entry, totpSecret: buildOtpauthUrl(entry) } : (entry ?? EMPTY_FORM),
  )
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [genOpen, setGenOpen] = useState(false)
  const [genMode, setGenMode] = useState<GeneratorMode>('chars')
  const [genOptions, setGenOptions] = useState(DEFAULT_GENERATOR)
  const [passOptions, setPassOptions] = useState(DEFAULT_PASS_GENERATOR)
  /** TOTP 秘钥即时校验错误（空串表示合法或未填写）；主进程 normalizeTotp 仍为最终防线 */
  const [totpError, setTotpError] = useState('')
  /** 名称字段是否失焦过：失焦后为空才显示必填提示（O22，避免初始新增即报错） */
  const [titleTouched, setTitleTouched] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    titleRef.current?.focus()
  }, [])

  const strength = useMemo(() => passwordStrength(form.password), [form.password])
  const canSubmit = form.title.trim().length > 0 && !busy
  // 名称必填即时提示（O22）：失焦过且为空才显示，与提交按钮的禁用原因呼应
  const titleError = titleTouched && !form.title.trim() ? t('form.nameRequired') : ''

  function patch(partial: Partial<EntryDraft>): void {
    setForm((prev) => ({ ...prev, ...partial }))
  }

  function handleGenerate(): void {
    patch({ password: genMode === 'chars' ? generatePassword(genOptions) : generatePassphrase(passOptions) })
  }

  /** 切换生成器模式（F20）：立即用新模式重新生成并写入表单 */
  function handleGenModeChange(mode: GeneratorMode): void {
    setGenMode(mode)
    patch({ password: mode === 'chars' ? generatePassword(genOptions) : generatePassphrase(passOptions) })
  }

  /** TOTP 输入即时校验：空值合法（不启用），非法时展示 parseTotpParams 的本地化错误（含参数校验，F18） */
  function handleTotpChange(raw: string): void {
    patch({ totpSecret: raw })
    if (!raw.trim()) {
      setTotpError('')
      return
    }
    try {
      parseTotpParams(raw)
      setTotpError('')
    } catch (err) {
      setTotpError(err instanceof Error ? err.message : t('form.totpFormatErr'))
    }
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (!canSubmit) return
    setBusy(true)
    setError('')
    try {
      await onSubmit({ ...form, title: form.title.trim() })
    } catch (err) {
      setError(resolveIpcError(err, t('form.saveFailed')))
      setBusy(false)
    }
  }

  return (
    <Modal title={entry ? t('form.titleEdit') : t('form.titleAdd')} onClose={onClose}>
      <form onSubmit={(e) => void handleSubmit(e)}>
        <label className="field-label" htmlFor="entry-title">
          {t('form.nameLabel')} <span className="required">*</span>
        </label>
        <input
          ref={titleRef}
          id="entry-title"
          className="input"
          type="text"
          placeholder={t('form.namePlaceholder')}
          value={form.title}
          onChange={(e) => patch({ title: e.target.value })}
          onBlur={() => setTitleTouched(true)}
        />
        {titleError && <p className="form-error">{titleError}</p>}

        <span className="field-label">{t('form.categoryLabel')}</span>
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
          {t('form.urlLabel')}
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
          {t('form.userLabel')}
        </label>
        <input
          id="entry-username"
          className="input"
          type="text"
          placeholder={t('form.userPlaceholder')}
          value={form.username}
          onChange={(e) => patch({ username: e.target.value })}
        />

        <div className="field-row">
          <label className="field-label" htmlFor="entry-password">
            {t('form.passwordLabel')}
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
            {genOpen ? t('form.genCollapse') : t('form.genButton')}
          </button>
        </div>
        <div className="password-input-wrap">
          <input
            id="entry-password"
            className="input"
            type={showPassword ? 'text' : 'password'}
            placeholder={t('form.passPlaceholder')}
            value={form.password}
            onChange={(e) => patch({ password: e.target.value })}
          />
          <button
            type="button"
            className="input-suffix"
            aria-label={showPassword ? t('form.hidePass') : t('form.showPass')}
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
          <PasswordGenerator
            mode={genMode}
            onModeChange={handleGenModeChange}
            options={genOptions}
            onChange={(next) => {
              setGenOptions(next)
              patch({ password: generatePassword(next) })
            }}
            passOptions={passOptions}
            onPassChange={(next) => {
              setPassOptions(next)
              patch({ password: generatePassphrase(next) })
            }}
            onRegenerate={handleGenerate}
          />
        )}

        <label className="field-label" htmlFor="entry-totp">
          {t('form.totpLabel')}
        </label>
        <input
          id="entry-totp"
          className="input mono"
          type="text"
          placeholder={t('form.totpPlaceholder')}
          value={form.totpSecret ?? ''}
          onChange={(e) => handleTotpChange(e.target.value)}
        />
        {totpError ? (
          <p className="form-error totp-error">{totpError}</p>
        ) : (
          <p className="gen-hint">{t('form.totpHint')}</p>
        )}

        <label className="field-label" htmlFor="entry-notes">
          {t('form.notesLabel')}
        </label>
        <textarea
          id="entry-notes"
          className="input textarea"
          rows={3}
          placeholder={t('form.notesPlaceholder')}
          value={form.notes}
          onChange={(e) => patch({ notes: e.target.value })}
        />

        <label className="checkbox favorite-checkbox">
          <input
            type="checkbox"
            checked={form.favorite === true}
            onChange={(e) => patch({ favorite: e.target.checked })}
          />
          <Icon name="star" size={14} filled />
          {t('form.favLabel')}
        </label>

        {error && <p className="form-error">{error}</p>}

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
            {entry ? t('form.saveEdit') : t('form.add')}
          </button>
        </div>
      </form>
    </Modal>
  )
}
