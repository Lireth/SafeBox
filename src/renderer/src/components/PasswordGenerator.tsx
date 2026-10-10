import { Icon } from './Icon'
import { t } from '../lib/i18n'
import type { GeneratorOptions } from '../lib/password'

interface PasswordGeneratorProps {
  /** 当前生成器选项（状态由父层持有：生成的密码要写回表单） */
  options: GeneratorOptions
  /** 选项变化（长度 / 字符类型）：父层更新选项并立即重新生成密码写回表单 */
  onChange: (next: GeneratorOptions) => void
  /** 手动重新生成（刷新按钮） */
  onRegenerate: () => void
}

/** 密码生成器面板（O25 自 EntryFormModal 拆出）：长度滑条 + 字符类型复选 + 重新生成 */
export function PasswordGenerator({ options, onChange, onRegenerate }: PasswordGeneratorProps): React.JSX.Element {
  return (
    <div className="generator">
      <div className="field-row">
        <span className="field-label">{t('form.genLength', { length: options.length })}</span>
        <button type="button" className="text-btn" onClick={onRegenerate}>
          <Icon name="refresh" size={13} />
          {t('form.regen')}
        </button>
      </div>
      <input
        type="range"
        min={8}
        max={64}
        className="range"
        value={options.length}
        onChange={(e) => onChange({ ...options, length: Number(e.target.value) })}
      />
      <div className="checkbox-group">
        {(
          [
            ['upper', t('form.genUpper')],
            ['lower', t('form.genLower')],
            ['digits', t('form.genDigits')],
            ['symbols', t('form.genSymbols')],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="checkbox">
            <input
              type="checkbox"
              checked={options[key]}
              onChange={(e) => {
                // 调整字符类型后立即重新生成
                onChange({ ...options, [key]: e.target.checked })
              }}
            />
            {label}
          </label>
        ))}
      </div>
      <p className="gen-hint">{t('form.genHint')}</p>
    </div>
  )
}
