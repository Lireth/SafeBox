import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearPwnedCache, fetchPwnedCount, findPwnedEntries, sha1HexUpper } from '../../src/renderer/src/lib/hibp'
import type { AccountEntry } from '../../shared/types'

const entry = (id: string, password: string): AccountEntry => ({
  id,
  title: id,
  category: 'other',
  url: '',
  username: '',
  password,
  notes: '',
  favorite: false,
  createdAt: 0,
  updatedAt: 0,
})

/** sha1('password123') = cbfdac6008f9cab4083784cbd1874f76618d2a97 → 前缀 CBFDA，后缀 C6008F9CAB4083784CBD1874F76618D2A97 */
const RESP_OK = '000000000000000000000000000000001:1\nC6008F9CAB4083784CBD1874F76618D2A97:5\nFFFFFFF:2\n'

describe('hibp（F21 泄露检查）', () => {
  afterEach(() => {
    clearPwnedCache()
    vi.unstubAllGlobals()
  })

  it('sha1HexUpper 输出 40 位大写 hex', async () => {
    const hex = await sha1HexUpper('password123')
    expect(hex).toMatch(/^[0-9A-F]{40}$/)
    expect(hex.startsWith('CBFDA')).toBe(true)
  })

  it('前 5 位前缀请求 + 后缀匹配计数；缓存生效（第二次不发请求）', async () => {
    const fetchMock = vi.fn(async (): Promise<Response> => new Response(RESP_OK, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await fetchPwnedCount('password123')).toBe(5)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/range/CBFDA')
    expect(await fetchPwnedCount('password123')).toBe(5)
    expect(fetchMock).toHaveBeenCalledTimes(1) // 第二次走缓存
  })

  it('未命中后缀计数为 0；HTTP 非 200 抛错', async () => {
    vi.stubGlobal('fetch', vi.fn(async (): Promise<Response> => new Response(RESP_OK, { status: 200 })))
    expect(await fetchPwnedCount('no-such-password-xyz')).toBe(0)
    vi.stubGlobal('fetch', vi.fn(async (): Promise<Response> => new Response('', { status: 500 })))
    await expect(fetchPwnedCount('password123')).rejects.toThrow('HIBP')
  })

  it('findPwnedEntries：命中收集、跳过空密码、失败标记并中止', async () => {
    const fetchMock = vi.fn(async (input: unknown): Promise<Response> => {
      return String(input).includes('/range/CBFDA') ? new Response(RESP_OK, { status: 200 }) : new Response('', { status: 503 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const entries = [entry('a', 'password123'), entry('b', ''), entry('c', 'other-password')]
    const result = await findPwnedEntries(entries)
    expect(result.list.map((e) => e.id)).toEqual(['a'])
    expect(result.failed).toBe(true)
  })
})
