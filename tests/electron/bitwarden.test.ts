import { describe, expect, it } from 'vitest'
import { mapBitwardenJson } from '../../electron/bitwarden'

const exportJson = (items: unknown[], extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ encrypted: false, items, ...extra })

describe('mapBitwardenJson（F22 Bitwarden JSON 导入）', () => {
  it('完整映射：name/login/uris/notes/totp/favorite', () => {
    const { drafts, invalid } = mapBitwardenJson(
      exportJson([
        {
          type: 1,
          name: ' GitHub ',
          notes: 'n1',
          favorite: true,
          login: {
            username: 'user@a.com',
            password: 'p1',
            totp: 'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP',
            uris: [{ uri: 'https://github.com' }],
          },
        },
      ]),
    )
    expect(invalid).toBe(0)
    expect(drafts).toEqual([
      {
        title: 'GitHub',
        category: 'other',
        url: 'https://github.com',
        username: 'user@a.com',
        password: 'p1',
        notes: 'n1',
        totpSecret: 'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP',
        favorite: true,
      },
    ])
  })

  it('无 login / 无 uris / favorite 缺省 → 空值草稿', () => {
    const { drafts } = mapBitwardenJson(exportJson([{ name: 'OnlyName' }]))
    expect(drafts[0]).toMatchObject({ title: 'OnlyName', url: '', username: '', password: '', favorite: false })
    expect(drafts[0].totpSecret).toBeUndefined()
  })

  it('缺名称与非法条目计入 invalid', () => {
    const { drafts, invalid } = mapBitwardenJson(exportJson([{ name: '  ' }, 'bad', { login: {} }]))
    expect(drafts).toHaveLength(0)
    expect(invalid).toBe(3)
  })

  it('加密导出 / 缺 items / 非 JSON 分别报专用错误', () => {
    expect(() => mapBitwardenJson(JSON.stringify({ encrypted: true, items: [] }))).toThrow('加密导出')
    expect(() => mapBitwardenJson('{"encrypted":false}')).toThrow('items')
    expect(() => mapBitwardenJson('not-json')).toThrow('JSON')
  })
})
