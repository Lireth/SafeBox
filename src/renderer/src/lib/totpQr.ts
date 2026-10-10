import qrcode from 'qrcode-generator'
import type { AccountEntry } from '../../../../shared/types'
import { buildOtpauthUrl } from './totp'

/**
 * TOTP 迁移二维码（F24）：otpauth URI → 内联 SVG（纯前端零网络）。
 * - URI 复用 F18 的 buildOtpauthUrl（label=SafeBox:{title}，含 period/digits/algorithm 自定义参数）
 * - QR 纠错级 M（容量与稳健性平衡，otpauth 链接典型 100-150 字节落在 auto 版本内）
 * - 输出 SVG 字符串（data URI 由组件层编码），渲染为白底黑码、静区 4 模块
 */

/** 生成可内联展示的二维码 SVG（crispEdges 保证小尺寸下模块边缘清晰） */
export function totpQrSvg(uri: string): string {
  const qr = qrcode(0, 'M')
  qr.addData(uri)
  qr.make()
  const count = qr.getModuleCount()
  const cell = 4
  const quiet = 4
  const size = (count + quiet * 2) * cell
  let path = ''
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (qr.isDark(row, col)) {
        const x = (col + quiet) * cell
        const y = (row + quiet) * cell
        path += `M${x} ${y}h${cell}v${cell}h-${cell}z`
      }
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" ` +
    `shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#ffffff"/><path d="${path}" fill="#000000"/></svg>`
  )
}

/** 条目 → data URI（img src 直接可用）；无秘钥返回 null */
export function totpQrDataUri(entry: AccountEntry): string | null {
  if (!entry.totpSecret) return null
  const uri = buildOtpauthUrl(entry)
  if (!uri) return null
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(totpQrSvg(uri))}`
}
