import { describe, expect, it } from 'vitest'
import { buildCsv, mapCsvEntries, mapCsvHeader, parseCsvRows } from '../../electron/csv'
import type { AccountEntry } from '../../shared/types'

/** 构造合法条目夹具（导出测试用） */
function entry(overrides: Partial<AccountEntry> & { title: string }): AccountEntry {
  const now = Date.now()
  return {
    id: 'id-' + overrides.title,
    category: 'other',
    url: '',
    username: '',
    password: '',
    notes: '',
    favorite: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
    title: overrides.title,
  }
}

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

describe('buildCsv（明文导出序列化，issue #32）', () => {
  it('表头对齐主流格式 + CRLF 行结束', () => {
    const csv = buildCsv([entry({ title: 'GitHub', url: 'https://github.com', username: 'u', password: 'p' })])
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe('name,url,username,password,notes,totp')
    expect(lines[1]).toBe('GitHub,https://github.com,u,p,,')
    expect(csv.endsWith('\r\n')).toBe(true)
  })

  it('含逗号/引号/换行的字段按 RFC 4180 转义', () => {
    const csv = buildCsv([entry({ title: 'Doe, John', notes: 'He said "hi"\nbye' })])
    const rows = parseCsvRows(csv)
    expect(rows[1][0]).toBe('Doe, John')
    expect(rows[1][4]).toBe('He said "hi"\nbye')
  })

  it('导出-解析往返一致（含特殊字符与 totp）', () => {
    const entries = [
      entry({ title: 'A', password: 'p@ss,1', totpSecret: 'JBSWY3DPEHPK3PXP' }),
      entry({ title: 'B "quoted"', username: 'x,y', notes: 'line1\r\nline2' }),
    ]
    const { drafts } = mapCsvEntries(parseCsvRows(buildCsv(entries)))
    expect(drafts).toHaveLength(2)
    expect(drafts[0]).toMatchObject({ title: 'A', password: 'p@ss,1', totpSecret: 'JBSWY3DPEHPK3PXP' })
    expect(drafts[1].title).toBe('B "quoted"')
    expect(drafts[1].username).toBe('x,y')
    expect(drafts[1].notes).toBe('line1\r\nline2')
  })

  it('软删除条目不导出；空列表仅表头', () => {
    const csv = buildCsv([entry({ title: 'Alive' }), entry({ title: 'Gone', deletedAt: Date.now() })])
    expect(csv).toContain('Alive')
    expect(csv).not.toContain('Gone')
    expect(buildCsv([])).toBe('name,url,username,password,notes,totp\r\n')
  })
})
