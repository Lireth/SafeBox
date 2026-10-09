import { describe, expect, it } from 'vitest'
import { mapCsvEntries, mapCsvHeader, parseCsvRows } from '../../electron/csv'

describe('parseCsvRows（RFC 4180 解析）', () => {
  it('基础逗号分隔与 CRLF 换行', () => {
    expect(parseCsvRows('a,b\r\nc,d\r\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })

  it('引号包裹字段、内嵌逗号与 "" 转义', () => {
    const rows = parseCsvRows('name,note\r\n"Doe, John","He said ""hi"""\r\n')
    expect(rows[1]).toEqual(['Doe, John', 'He said "hi"'])
  })

  it('引号字段内换行不作为行分隔', () => {
    const rows = parseCsvRows('a,b\r\n"x\ny",z\r\n')
    expect(rows).toHaveLength(2)
    expect(rows[1]).toEqual(['x\ny', 'z'])
  })

  it('剥离 UTF-8 BOM', () => {
    const rows = parseCsvRows('\ufeffname,url\r\n')
    expect(rows[0][0]).toBe('name')
  })

  it('无结尾换行时保留末行；空文本返回空数组', () => {
    expect(parseCsvRows('a,b\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
    expect(parseCsvRows('')).toEqual([])
  })
})

describe('mapCsvHeader（表头候选列匹配）', () => {
  it('Chrome 表头', () => {
    const h = mapCsvHeader(['name', 'origin', 'username', 'password', 'note', 'otp_auth_token'])
    expect(h).toEqual({ title: 0, url: 1, username: 2, password: 3, notes: 4, totpSecret: 5 })
  })

  it('Bitwarden 表头（含空格/下划线，大小写不敏感）', () => {
    const h = mapCsvHeader(['Name', 'Favicon URL', 'Last Updated', 'Username', 'Password', 'Notes', 'Login TOTP', 'Uri List'])
    expect(h.title).toBe(0)
    expect(h.url).toBe(1)
    expect(h.username).toBe(3)
    expect(h.password).toBe(4)
    expect(h.notes).toBe(5)
    expect(h.totpSecret).toBe(6)
  })

  it('1Password 表头（Title / Url / User name / Password / Notes / Section）', () => {
    const h = mapCsvHeader(['Title', 'Url', 'User name', 'Password', 'Notes', 'Section'])
    expect(h.title).toBe(0)
    expect(h.url).toBe(1)
    expect(h.password).toBe(3)
    expect(h.notes).toBe(4)
  })

  it('无匹配列返回 -1', () => {
    const h = mapCsvHeader(['foo', 'bar'])
    expect(h.title).toBe(-1)
  })
})

describe('mapCsvEntries（行映射与容错）', () => {
  const chromeHeader = 'name,origin,username,password,note,otp_auth_token'

  it('Chrome 样例完整映射', () => {
    const csv = `${chromeHeader}\r\nGitHub,https://github.com,me,p@ss,"a note",JBSWY3DPEHPK3PXP\r\n`
    const { drafts, invalid } = mapCsvEntries(parseCsvRows(csv))
    expect(invalid).toBe(0)
    expect(drafts).toHaveLength(1)
    expect(drafts[0]).toEqual({
      title: 'GitHub',
      category: 'other',
      url: 'https://github.com',
      username: 'me',
      password: 'p@ss',
      notes: 'a note',
      totpSecret: 'JBSWY3DPEHPK3PXP',
    })
  })

  it('Bitwarden TOTP 列的 | 参数尾巴被截断', () => {
    const csv = `Name,Username,Password,Notes,Login TOTP\r\nX,u,p,,otpauth://totp/X?secret=ABCD2345&issuer=X|digits=6|period=30\r\n`
    const { drafts } = mapCsvEntries(parseCsvRows(csv))
    expect(drafts[0].totpSecret).toBe('otpauth://totp/X?secret=ABCD2345&issuer=X')
  })

  it('缺名称行计入 invalid 并跳过；空行忽略', () => {
    const csv = `${chromeHeader}\r\n,https://x.com,u,p,,\r\n\r\nOK,u2,p2,,,\r\n`
    const { drafts, invalid } = mapCsvEntries(parseCsvRows(csv))
    expect(invalid).toBe(1)
    expect(drafts.map((d) => d.title)).toEqual(['OK'])
  })

  it('无名称列抛中文错误', () => {
    expect(() => mapCsvEntries(parseCsvRows('foo,bar\r\n1,2'))).toThrow('无法识别 CSV 表头')
  })

  it('空文件抛错', () => {
    expect(() => mapCsvEntries([])).toThrow('CSV 文件为空')
  })
})
