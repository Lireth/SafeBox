import { describe, expect, it } from 'vitest'
import { totpQrDataUri, totpQrSvg } from '../../src/renderer/src/lib/totpQr'
import type { AccountEntry } from '../../shared/types'

const entry = (totpSecret: string): AccountEntry => ({
  id: 'e1',
  title: 'GitHub',
  category: 'dev',
  url: '',
  username: '',
  password: '',
  notes: '',
  favorite: false,
  createdAt: 0,
  updatedAt: 0,
  totpSecret,
})

describe('totpQr（F24 TOTP 迁移二维码）', () => {
  it('SVG 结构：白底黑码、正方形尺寸、含大量模块路径', () => {
    const svg = totpQrSvg('otpauth://totp/SafeBox:GitHub?secret=JBSWY3DPEHPK3PXP&issuer=SafeBox')
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
    expect(svg).toContain('fill="#ffffff"')
    expect(svg).toContain('fill="#000000"')
    expect(svg).toContain('shape-rendering="crispEdges"')
    // 同一 URI 输出稳定；不同 URI 尺寸可能不同但均为整数 viewBox
    expect(svg).toBe(totpQrSvg('otpauth://totp/SafeBox:GitHub?secret=JBSWY3DPEHPK3PXP&issuer=SafeBox'))
    expect(svg).toMatch(/viewBox="0 0 (\d+) \1"/)
  })

  it('dataUri：有秘钥生成 data:image/svg+xml；无秘钥返回 null', () => {
    const uri = totpQrDataUri(entry('JBSWY3DPEHPK3PXP'))
    expect(uri).toMatch(/^data:image\/svg\+xml;charset=utf-8,%3Csvg/)
    expect(totpQrDataUri({ ...entry('JBSWY3DPEHPK3PXP'), totpSecret: undefined })).toBeNull()
  })
})
