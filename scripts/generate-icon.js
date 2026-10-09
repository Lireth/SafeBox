/**
 * 应用图标生成脚本（零依赖，可复现构建）
 * 产出：
 *   build/icon.ico  — 16/32/48/64/128/256 多尺寸 PNG-in-ICO
 *   build/icon.png  — 512x512 源图
 * 设计：accent 渐变圆角底 + 白色盾形 + 盾内挂锁（呼应「秘匣」品牌）
 * 运行：node scripts/generate-icon.js
 */
const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')

const SIZE = 512
const SS = 4 // 抗锯齿超采样倍数
const OUT_DIR = path.resolve(__dirname, '..', 'build')

// ---------- 基础色 ----------
const BG_TOP = [90, 93, 224] // #5a5de0
const BG_BOTTOM = [64, 67, 181] // #4043b5
const WHITE = [255, 255, 255]
const ACCENT = [84, 87, 214] // #5457d6

// ---------- 几何工具 ----------
function insideRoundedRect(px, py, x, y, w, h, r) {
  if (px < x || py < y || px > x + w || py > y + h) return false
  const cx = Math.min(Math.max(px, x + r), x + w - r)
  const cy = Math.min(Math.max(py, y + r), y + h - r)
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r
}

function insidePolygon(px, py, points) {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i]
    const [xj, yj] = points[j]
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function insideAnnulus(px, py, cx, cy, rOuter, rInner, minAngle, maxAngle) {
  const dx = px - cx
  const dy = py - cy
  const dist = Math.hypot(dx, dy)
  if (dist > rOuter || dist < rInner) return false
  // 角度归一到 [0, 2π)，y 轴向下
  let angle = Math.atan2(dy, dx)
  if (angle < 0) angle += Math.PI * 2
  return angle >= minAngle && angle <= maxAngle
}

// ---------- 图标绘制（返回 [r,g,b,a]） ----------
const CX = 256
const SHIELD_HALF = 118
// 盾形多边形（模拟底部收弧）
const SHIELD = [
  [CX - SHIELD_HALF, 136],
  [CX + SHIELD_HALF, 136],
  [CX + SHIELD_HALF, 250],
  [CX + SHIELD_HALF * 0.72, 330],
  [CX + SHIELD_HALF * 0.38, 380],
  [CX, 396],
  [CX - SHIELD_HALF * 0.38, 380],
  [CX - SHIELD_HALF * 0.72, 330],
  [CX - SHIELD_HALF, 250]
]

function blend(base, overlay, alpha) {
  return [
    base[0] + (overlay[0] - base[0]) * alpha,
    base[1] + (overlay[1] - base[1]) * alpha,
    base[2] + (overlay[2] - base[2]) * alpha
  ]
}

function sample(u, v) {
  // u, v ∈ [0, 1)
  const x = u * SIZE
  const y = v * SIZE
  // 背景渐变圆角方块
  if (!insideRoundedRect(x, y, 16, 16, SIZE - 32, SIZE - 32, 108)) return [0, 0, 0, 0]
  const t = y / SIZE
  let color = [
    BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t,
    BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t,
    BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t
  ]

  // 白色盾形
  if (insidePolygon(x, y, SHIELD)) {
    color = blend(color, WHITE, 1)

    // 挂锁：锁环上半弧
    if (insideAnnulus(x, y, CX, 262, 40, 24, Math.PI, Math.PI * 2)) {
      color = blend(color, ACCENT, 1)
    }
    // 锁体
    if (insideRoundedRect(x, y, CX - 54, 258, 108, 84, 12)) {
      color = blend(color, ACCENT, 1)
      // 锁孔（白色）
      if (Math.hypot(x - CX, y - 298) <= 9 || insideRoundedRect(x, y, CX - 5, 298, 10, 24, 5)) {
        color = blend(color, WHITE, 1)
      }
    }
  }
  return [...color, 255]
}

function render(size) {
  const rgba = Buffer.alloc(size * size * 4)
  const step = SIZE / size
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      // 4x4 超采样抗锯齿
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const [cr, cg, cb, ca] = sample((px + (sx + 0.5) / SS) * step / SIZE, (py + (sy + 0.5) / SS) * step / SIZE)
          r += cr * ca
          g += cg * ca
          b += cb * ca
          a += ca
        }
      }
      const n = SS * SS
      const alpha = a / n
      const offset = (py * size + px) * 4
      rgba[offset] = alpha > 0 ? Math.round(r / a) : 0
      rgba[offset + 1] = alpha > 0 ? Math.round(g / a) : 0
      rgba[offset + 2] = alpha > 0 ? Math.round(b / a) : 0
      rgba[offset + 3] = Math.round(alpha)
    }
  }
  return rgba
}

// ---------- PNG 编码（纯手写，RGBA 8bit） ----------
const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let crc = -1
  for (const byte of buf) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ -1) >>> 0
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePNG(size, rgba) {
  const stride = size * 4 + 1
  const raw = Buffer.alloc(stride * size)
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0 // filter: None
    rgba.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

// ---------- ICO 容器（PNG-in-ICO） ----------
function encodeICO(pngs) {
  const count = pngs.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(count, 4)

  const entries = Buffer.alloc(16 * count)
  let offset = 6 + 16 * count
  const blobs = []
  pngs.forEach((item, index) => {
    const entryBase = index * 16
    const dim = item.size >= 256 ? 0 : item.size
    entries[entryBase] = dim
    entries[entryBase + 1] = dim
    entries[entryBase + 2] = 0 // palette
    entries[entryBase + 3] = 0 // reserved
    entries.writeUInt16LE(1, entryBase + 4) // planes
    entries.writeUInt16LE(32, entryBase + 6) // bit count
    entries.writeUInt32LE(item.png.length, entryBase + 8)
    entries.writeUInt32LE(offset, entryBase + 12)
    offset += item.png.length
    blobs.push(item.png)
  })
  return Buffer.concat([header, entries, ...blobs])
}

// ---------- 执行 ----------
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true })

const sizes = [16, 32, 48, 64, 128, 256]
const pngs = sizes.map((size) => ({ size, png: encodePNG(size, render(size)) }))
fs.writeFileSync(path.join(OUT_DIR, 'icon.ico'), encodeICO(pngs))
fs.writeFileSync(path.join(OUT_DIR, 'icon.png'), encodePNG(SIZE, render(SIZE)))
console.log('[icon] 已生成 build/icon.ico（' + sizes.join('/') + '）与 build/icon.png（512）')
