import { Icon } from './Icon'
import { t } from '../lib/i18n'
import type { GeneratorOptions, PassphraseOptions } from '../lib/password'

export type GeneratorMode = 'chars' | 'words'

interface PasswordGeneratorProps {
  /** 生成器模式（状态由父层持有：生成的密码要写回表单） */
  mode: GeneratorMode
  onModeChange: (mode: GeneratorMode) => void
  /** 随机字符模式选项 */
  options: GeneratorOptions
  /** 字符选项变化（长度 / 字符类型）：父层更新选项并立即重新生成密码写回表单 */
  onChange: (next: GeneratorOptions) => void
  /** 口令短语模式选项（F20） */
  passOptions: PassphraseOptions
  onPassChange: (next: PassphraseOptions) => void
  /** 手动重新生成（刷新按钮） */
  onRegenerate: () => void
}

const SEPARATORS = ['-', '.', '_', ' '] as const

/** 密码生成器面板（O25 自 EntryFormModal 拆出）：随机字符 / 口令短语双模式（F20） */
export function PasswordGenerator({
  mode,
  onModeChange,
  options,
  onChange,
  passOptions,
  onPassChange,
  onRegenerate,
}: PasswordGeneratorProps): React.JSX.Element {
  return (
    <div className="generator">
      <div className="field-row">
        <span className="field-label">{mode === 'chars' ? t('form.genLength', { length: options.length }) : t('form.passCount', { count: passOptions.count })}</span>
        <button type="button" className="text-btn" onClick={onRegenerate}>
          <Icon name="refresh" size={13} />
          {t('form.regen')}
        </button>
      </div>

      {/* 模式切换：切换后由父层立即用新模式重新生成写入表单 */}
      <div className="checkbox-group">
        <label className="checkbox">
          <input
            type="radio"
            name="generator-mode"
            checked={mode === 'chars'}
            onChange={() => onModeChange('chars')}
          />
          {t('form.genModeChars')}
        </label>
        <label className="checkbox">
          <input
            type="radio"
            name="generator-mode"
            checked={mode === 'words'}
            onChange={() => onModeChange('words')}
          />
          {t('form.genModeWords')}
        </label>
      </div>

      {mode === 'chars' ? (
        <>
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
        </>
      ) : (
        <>
          <input
            type="range"
            min={3}
            max={8}
            className="range"
            value={passOptions.count}
            onChange={(e) => onPassChange({ ...passOptions, count: Number(e.target.value) })}
          />
          <span className="field-label">{t('form.passSeparator')}</span>
          <div className="checkbox-group">
            {SEPARATORS.map((sep) => (
              <label key={sep} className="checkbox">
                <input
                  type="radio"
                  name="passphrase-separator"
                  checked={passOptions.separator === sep}
                  onChange={() => onPassChange({ ...passOptions, separator: sep })}
                />
                {/* 空格分隔符展示为可见符号 */}
                <code className="mono">{sep === ' ' ? '␣' : sep}</code>
              </label>
            ))}
          </div>
          <div className="checkbox-group">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={passOptions.capitalize}
                onChange={(e) => onPassChange({ ...passOptions, capitalize: e.target.checked })}
              />
              {t('form.passCapitalize')}
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={passOptions.appendNumber}
                onChange={(e) => onPassChange({ ...passOptions, appendNumber: e.target.checked })}
              />
              {t('form.passAppendNumber')}
            </label>
          </div>
          <p className="gen-hint">{t('form.passHint')}</p>
        </>
      )}
    </div>
  )
}
