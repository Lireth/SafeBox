import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VaultStore } from '../../electron/vault'
import type { AccountEntry, EntryDraft } from '../../shared/types'
import { safeStorage } from '../mocks/electron'

/** 构造合法草稿，测试中按需覆盖字段 */
function draft(overrides: Partial<EntryDraft> = {}): EntryDraft {
  return { title: 'T', category: 'other', url: '', username: '', password: '', notes: '', ...overrides }
}

describe('VaultStore', () => {
  let tmpDir: string
  let store: VaultStore

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'safebox-vault-'))
    store = new VaultStore(tmpDir)
    store.load()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  describe('持久化与加载状态', () => {
    it('首次加载返回 empty 状态', () => {
      expect(store.getLoadStatus()).toEqual({ status: 'empty' })
      expect(store.list()).toEqual([])
    })

    it('add 后条目可列出并以加密格式落盘', () => {
      const entry = store.add(draft({ title: 'GitHub', category: 'dev', username: 'u', password: 'p' }))
      expect(entry.id).toBeTruthy()
      const list = store.list()
      expect(list).toHaveLength(1)
      expect(list[0].title).toBe('GitHub')
      expect(list[0].category).toBe('dev')
      expect(list[0].favorite).toBe(false)
      expect(list[0].createdAt).toBeGreaterThan(0)

      const file = path.join(tmpDir, 'vault.safebox')
      expect(fs.existsSync(file)).toBe(true)
      const meta = JSON.parse(fs.readFileSync(file, 'utf-8'))
      expect(meta.encrypted).toBe(true)
      // 密文不包含明文
      expect(meta.payload).not.toContain('GitHub')
    })

    it('重新实例化可从磁盘还原数据（加密往返一致）', () => {
      store.add(draft({ title: '邮箱', category: 'email', username: 'a@b.c' }))
      const reloaded = new VaultStore(tmpDir)
      reloaded.load()
      expect(reloaded.getLoadStatus()).toEqual({ status: 'ok' })
      expect(reloaded.list()).toHaveLength(1)
      expect(reloaded.list()[0].title).toBe('邮箱')
    })

    it('损坏文件降级：备份后从空数据开始并上报 broken 状态', () => {
      fs.writeFileSync(path.join(tmpDir, 'vault.safebox'), '{{{ not valid json', 'utf-8')
      store.load()
      const status = store.getLoadStatus()
      expect(status.status).toBe('broken')
      expect(status.backupFile).toMatch(/vault\.safebox\.broken-\d+$/)
      expect(store.list()).toEqual([])
      // 备份文件保留在数据目录
      expect(fs.existsSync(path.join(tmpDir, status.backupFile as string))).toBe(true)
    })

    it('备份轮换：跨时间窗多次保存仅保留最近 3 份 .bak', () => {
      vi.useFakeTimers()
      store.add(draft({ title: 'T0' })) // 首次写盘：文件尚不存在，无备份
      // 每次推进 61 秒越过时间窗，确保每轮都产生新备份，验证轮换封顶
      for (let i = 1; i <= 5; i++) {
        vi.advanceTimersByTime(61_000)
        store.add(draft({ title: `T${i}` }))
      }
      const baks = fs.readdirSync(tmpDir).filter((f) => f.includes('.bak-'))
      expect(baks).toHaveLength(3)
      vi.useRealTimers()
    })

    it('时间窗合并：60 秒内多次保存只产生 1 份 .bak（issue #31）', () => {
      vi.useFakeTimers()
      store.add(draft({ title: 'T0' })) // 创建文件
      for (let i = 1; i <= 5; i++) {
        vi.advanceTimersByTime(10_000) // 累计 50 秒，始终 < 60 秒窗口
        store.add(draft({ title: `T${i}` }))
      }
      const baks = fs.readdirSync(tmpDir).filter((f) => f.includes('.bak-'))
      // 仅第 2 次保存产生 1 份自动备份，其余被时间窗跳过
      expect(baks).toHaveLength(1)
      vi.useRealTimers()
    })

    it('导入合并强制备份：时间窗内仍产生新 .bak（issue #31）', () => {
      vi.useFakeTimers()
      store.add(draft({ title: 'T0' }))
      store.add(draft({ title: 'T1' })) // 产生首份自动备份，锁定时间窗
      const before = fs.readdirSync(tmpDir).filter((f) => f.includes('.bak-')).length
      vi.advanceTimersByTime(1_000) // 仍在 60 秒窗口内
      store.mergeEntries([
        {
          id: 'imported-1',
          title: '导入条目',
          category: 'other',
          url: '',
          username: 'u',
          password: 'p',
          notes: '',
          favorite: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ])
      const after = fs.readdirSync(tmpDir).filter((f) => f.includes('.bak-')).length
      // 强制备份绕过时间窗：新增 1 份
      expect(after).toBe(before + 1)
      vi.useRealTimers()
    })

    it('重启后首次备份全量扫描磁盘遗留 .bak 并纳入轮换封顶', () => {
      vi.useFakeTimers()
      // 首实例跨窗口产生 3 份备份
      store.add(draft({ title: 'T0' }))
      for (let i = 1; i <= 3; i++) {
        vi.advanceTimersByTime(61_000)
        store.add(draft({ title: `T${i}` }))
      }
      expect(fs.readdirSync(tmpDir).filter((f) => f.includes('.bak-'))).toHaveLength(3)
      // 模拟进程重启：新实例缓存为空，首次备份触发全量扫描
      const rebooted = new VaultStore(tmpDir)
      rebooted.load()
      vi.advanceTimersByTime(61_000)
      rebooted.add(draft({ title: 'T-after' }))
      // 遗留 3 份 + 新增 1 份 = 4，轮换封顶回到 3
      expect(fs.readdirSync(tmpDir).filter((f) => f.includes('.bak-'))).toHaveLength(3)
      vi.useRealTimers()
    })

    it('clearMemory 仅清空内存，磁盘文件不受影响', () => {
      store.add(draft())
      store.clearMemory()
      expect(store.list()).toEqual([])
      expect(fs.existsSync(path.join(tmpDir, 'vault.safebox'))).toBe(true)
    })
  })

  describe('normalizeDraft 输入校验（经 add 入口）', () => {
    it('空标题拒绝', () => {
      expect(() => store.add(draft({ title: '   ' }))).toThrow('请填写账号名称')
    })

    it('标题超过 100 字符拒绝', () => {
      expect(() => store.add(draft({ title: 'x'.repeat(101) }))).toThrow('名称过长')
    })

    it('标题自动去除首尾空白', () => {
      store.add(draft({ title: '  ABC  ' }))
      expect(store.list()[0].title).toBe('ABC')
    })

    it('不在预置列表的分类归入 other', () => {
      store.add(draft({ category: 'hacker' }))
      expect(store.list()[0].category).toBe('other')
    })

    it('密码超长静默截断到 500 字符', () => {
      store.add(draft({ password: 'x'.repeat(501) }))
      expect(store.list()[0].password).toHaveLength(500)
    })

    it('网址超过 500 字符拒绝', () => {
      expect(() => store.add(draft({ url: 'https://' + 'a'.repeat(500) }))).toThrow('网址过长')
    })

    it('备注超过 2000 字符拒绝', () => {
      expect(() => store.add(draft({ notes: 'n'.repeat(2001) }))).toThrow('备注过长')
    })

    it('用户名为非字符串类型时拒绝', () => {
      expect(() => store.add(draft({ username: 123 as unknown as string }))).toThrow('用户名 格式错误')
    })
  })

  describe('CRUD 与异常路径', () => {
    it('update 修改字段且保持 id 不变', () => {
      const created = store.add(draft({ title: '旧' }))
      const updated = store.update(created.id, draft({ title: '新', category: 'work' }))
      expect(updated.id).toBe(created.id)
      expect(updated.title).toBe('新')
      expect(updated.category).toBe('work')
      expect(store.list()[0].title).toBe('新')
    })

    it('update 不存在的 id 抛错', () => {
      expect(() => store.update('no-such-id', draft())).toThrow('账号不存在')
    })

    it('remove 为软删除：条目保留，标记 deletedAt 并落盘', () => {
      const created = store.add(draft())
      store.remove(created.id)
      // 条目仍在存储中（进入回收站），带 deletedAt 标记
      const list = store.list()
      expect(list).toHaveLength(1)
      expect(typeof list[0].deletedAt).toBe('number')
      expect(list[0].title).toBe('T')
      // 重复删除幂等，不抛错
      expect(() => store.remove(created.id)).not.toThrow()
      // 软删除标记已持久化
      const meta = JSON.parse(fs.readFileSync(path.join(tmpDir, 'vault.safebox'), 'utf-8'))
      const diskJson = meta.encrypted ? safeStorage.decryptString(Buffer.from(meta.payload, 'base64')) : meta.payload
      expect(diskJson).toContain('deletedAt')
    })

    it('toggleFavorite 在 false 与 true 间切换', () => {
      const created = store.add(draft())
      expect(store.toggleFavorite(created.id).favorite).toBe(true)
      expect(store.toggleFavorite(created.id).favorite).toBe(false)
      expect(() => store.toggleFavorite('no-such-id')).toThrow('账号不存在')
    })
  })

  describe('回收站（软删除 / 恢复 / 彻底删除 / 自动清理）', () => {
    it('restore 清除 deletedAt，条目回到正常状态', () => {
      const created = store.add(draft({ title: '误删' }))
      store.remove(created.id)
      const restored = store.restore(created.id)
      expect(restored.id).toBe(created.id)
      expect(restored.deletedAt).toBeUndefined()
      const list = store.list()
      expect(list).toHaveLength(1)
      expect(list[0].deletedAt).toBeUndefined()
    })

    it('restore 不存在或未删除的条目抛错', () => {
      expect(() => store.restore('no-such-id')).toThrow('账号不存在')
      const created = store.add(draft())
      expect(() => store.restore(created.id)).toThrow('该账号不在回收站中')
    })

    it('purge 物理删除条目，重复 purge 抛错', () => {
      const created = store.add(draft())
      store.remove(created.id)
      store.purge(created.id)
      expect(store.list()).toEqual([])
      expect(() => store.purge(created.id)).toThrow('账号不存在')
      // purge 不允许绕过软删除直接物理删除未删除条目
      expect(() => store.purge(store.add(draft()).id)).toThrow('该账号不在回收站中')
    })

    it('purgeExpired(0) 清理全部已删除条目，未删除条目不受影响', () => {
      const keep = store.add(draft({ title: '保留' }))
      const del1 = store.add(draft({ title: '删除1' }))
      const del2 = store.add(draft({ title: '删除2' }))
      store.remove(del1.id)
      store.remove(del2.id)
      expect(store.purgeExpired(0)).toBe(2)
      expect(store.list().map((e) => e.id)).toEqual([keep.id])
      // 无可清理时返回 0
      expect(store.purgeExpired(0)).toBe(0)
    })

    it('purgeExpired(30 天) 不清理刚删除的条目', () => {
      const created = store.add(draft())
      store.remove(created.id)
      expect(store.purgeExpired(30 * 24 * 60 * 60 * 1000)).toBe(0)
      expect(store.list()).toHaveLength(1)
    })

    it('restoreAll 清除全部软删除标记并返回数量（F19）', () => {
      const a = store.add(draft({ title: 'A' }))
      const b = store.add(draft({ title: 'B' }))
      const keep = store.add(draft({ title: '未删除' }))
      store.remove(a.id)
      store.remove(b.id)
      expect(store.restoreAll()).toBe(2)
      const list = store.list()
      expect(list).toHaveLength(3)
      expect(list.find((e) => e.id === a.id)?.deletedAt).toBeUndefined()
      expect(list.find((e) => e.id === b.id)?.deletedAt).toBeUndefined()
      expect(list.find((e) => e.id === keep.id)?.deletedAt).toBeUndefined()
      // 回收站已空：再恢复返回 0 且不产生变更
      expect(store.restoreAll()).toBe(0)
    })

    it('purgeAll 仅物理删除回收站条目，未删除数据不受影响（F19）', () => {
      const keep = store.add(draft({ title: '保留' }))
      const del1 = store.add(draft({ title: '删除1' }))
      const del2 = store.add(draft({ title: '删除2' }))
      store.remove(del1.id)
      store.remove(del2.id)
      expect(store.purgeAll()).toBe(2)
      expect(store.list().map((e) => e.id)).toEqual([keep.id])
      // 回收站已空：再清空返回 0
      expect(store.purgeAll()).toBe(0)
      // 加密落盘往返：清空结果持久化（模拟重启）
      const reloaded = new VaultStore(tmpDir)
      reloaded.load()
      expect(reloaded.list().map((e) => e.id)).toEqual([keep.id])
    })

    it('restoreAll / purgeAll 空回收站直接返回 0', () => {
      store.add(draft({ title: '未删除' }))
      expect(store.restoreAll()).toBe(0)
      expect(store.purgeAll()).toBe(0)
      // 全部条目未删除：列表不变
      expect(store.list()).toHaveLength(1)
    })

    it('磁盘上软删除超期的条目在启动清理中被物理移除', () => {
      const now = Date.now()
      const base = { category: 'dev', url: '', username: '', password: '', notes: '', favorite: false }
      const stale = { id: 'stale-1', title: '超期', ...base, createdAt: 1, updatedAt: 2, deletedAt: now - 31 * 24 * 60 * 60 * 1000 }
      const fresh = { id: 'fresh-1', title: '未超期', ...base, createdAt: 1, updatedAt: 2, deletedAt: now - 1000 }
      const normal = { id: 'normal-1', title: '正常', ...base, createdAt: 1, updatedAt: 2 }
      writeRawStore(tmpDir, [stale, fresh, normal])

      const reloaded = new VaultStore(tmpDir)
      reloaded.load()
      expect(reloaded.getLoadStatus()).toEqual({ status: 'ok' })
      expect(reloaded.purgeExpired(30 * 24 * 60 * 60 * 1000)).toBe(1)
      expect(reloaded.list().map((e) => e.id)).toEqual(['fresh-1', 'normal-1'])
    })

    it('旧版本数据文件（v2，无 deletedAt）升级后无缝兼容', () => {
      const legacy = {
        id: 'legacy-1',
        title: '旧数据',
        category: 'dev',
        url: '',
        username: 'u',
        password: 'p',
        notes: '',
        favorite: false,
        createdAt: 1,
        updatedAt: 2,
      }
      writeRawStore(tmpDir, [legacy], 2)

      const reloaded = new VaultStore(tmpDir)
      reloaded.load()
      expect(reloaded.getLoadStatus()).toEqual({ status: 'ok' })
      const list = reloaded.list()
      expect(list).toHaveLength(1)
      expect(list[0].title).toBe('旧数据')
      expect(list[0].deletedAt).toBeUndefined()
      // 升级后可正常走软删除流程
      reloaded.remove('legacy-1')
      expect(typeof reloaded.list()[0].deletedAt).toBe('number')
      expect(reloaded.restore('legacy-1').deletedAt).toBeUndefined()
    })

    it('mergeEntries 保留备份中条目的软删除状态', () => {
      const base = { title: 'B', category: 'dev', url: '', username: '', password: '', notes: '', favorite: false }
      const stats = store.mergeEntries([
        { ...base, id: 'b1', createdAt: 1, updatedAt: 2, deletedAt: 123456 },
        { ...base, id: 'b2', createdAt: 1, updatedAt: 2 },
        { ...base, id: 'b3', createdAt: 1, updatedAt: 2, deletedAt: 'bad' as unknown as number },
      ])
      expect(stats).toEqual({ imported: 3, skipped: 0 })
      const list = store.list()
      expect(list.find((e) => e.id === 'b1')?.deletedAt).toBe(123456)
      expect(list.find((e) => e.id === 'b2')?.deletedAt).toBeUndefined()
      expect(list.find((e) => e.id === 'b3')?.deletedAt).toBeUndefined()
    })
  })

  describe('TOTP 秘钥存储', () => {
    it('裸 Base32 规范化存储（大写、去空格与填充）', () => {
      const created = store.add(draft({ totpSecret: 'abcd 2345 abcd' }))
      expect(created.totpSecret).toBe('ABCD2345ABCD')
    })

    it('otpauth:// 链接提取 secret 参数存储', () => {
      const created = store.add(draft({ totpSecret: 'otpauth://totp/GitHub:me?secret=abcd2345abcd2345&issuer=GitHub' }))
      expect(created.totpSecret).toBe('ABCD2345ABCD2345')
    })

    it('空值与纯空白不产生字段', () => {
      expect(store.add(draft()).totpSecret).toBeUndefined()
      expect(store.add(draft({ totpSecret: '   ' })).totpSecret).toBeUndefined()
    })

    it('非法秘钥拒绝', () => {
      expect(() => store.add(draft({ totpSecret: 'otpauth://hotp/x?secret=ABCD2345ABCD' }))).toThrow('仅支持 totp 类型')
      expect(() => store.add(draft({ totpSecret: 'otpauth://totp/x?issuer=Y' }))).toThrow('缺少 secret')
      expect(() => store.add(draft({ totpSecret: 'ABCD234!' }))).toThrow('Base32')
      expect(() => store.add(draft({ totpSecret: 'AB1' }))).toThrow('过短')
      expect(() => store.add(draft({ totpSecret: 123 as unknown as string }))).toThrow('TOTP 秘钥格式错误')
    })

    it('update 可清除或替换 totpSecret', () => {
      const created = store.add(draft({ totpSecret: 'ABCD2345ABCD' }))
      expect(store.update(created.id, draft()).totpSecret).toBeUndefined()
      const again = store.update(created.id, draft({ totpSecret: 'otpauth://totp/x?secret=efff2345efff2345' }))
      expect(again.totpSecret).toBe('EFFF2345EFFF2345')
    })

    it('秘钥落盘受整体加密保护，密文中不可见明文', () => {
      store.add(draft({ totpSecret: 'ABCD2345ABCD2345' }))
      const meta = JSON.parse(fs.readFileSync(path.join(tmpDir, 'vault.safebox'), 'utf-8'))
      expect(meta.encrypted).toBe(true)
      // base64 密文不包含秘钥明文
      expect(meta.payload).not.toContain('ABCD2345ABCD2345')
    })

    it('mergeEntries 保留备份中的 totpSecret 并校验非法值', () => {
      const base = { title: 'B', category: 'dev', url: '', username: '', password: '', notes: '', favorite: false }
      store.mergeEntries([{ ...base, id: 't1', createdAt: 1, updatedAt: 2, totpSecret: 'abcd2345abcd2345' }])
      expect(store.list()[0].totpSecret).toBe('ABCD2345ABCD2345')
      expect(() =>
        store.mergeEntries([{ ...base, id: 't2', createdAt: 1, updatedAt: 2, totpSecret: '!!!' }]),
      ).toThrow('Base32')
    })

    it('otpauth 参数（period/digits/algorithm）随秘钥解析存储（F18）', () => {
      const created = store.add(
        draft({ totpSecret: 'otpauth://totp/x?secret=abcd2345abcd2345&period=60&digits=8&algorithm=sha256' }),
      )
      expect(created.totpSecret).toBe('ABCD2345ABCD2345')
      expect(created.totpPeriod).toBe(60)
      expect(created.totpDigits).toBe(8)
      expect(created.totpAlgorithm).toBe('SHA256')
    })

    it('默认参数不落盘（30/6/SHA1 归一为缺省，数据最小冗余）', () => {
      const created = store.add(
        draft({ totpSecret: 'otpauth://totp/x?secret=abcd2345abcd2345&period=30&digits=6&algorithm=SHA1' }),
      )
      expect(created.totpSecret).toBe('ABCD2345ABCD2345')
      expect(created.totpPeriod).toBeUndefined()
      expect(created.totpDigits).toBeUndefined()
      expect(created.totpAlgorithm).toBeUndefined()
    })

    it('非法参数拒绝（F18）', () => {
      expect(() => store.add(draft({ totpSecret: 'otpauth://totp/x?secret=abcd2345abcd2345&period=0' }))).toThrow('周期')
      expect(() => store.add(draft({ totpSecret: 'otpauth://totp/x?secret=abcd2345abcd2345&period=abc' }))).toThrow('周期')
      expect(() => store.add(draft({ totpSecret: 'otpauth://totp/x?secret=abcd2345abcd2345&period=3601' }))).toThrow('周期')
      expect(() => store.add(draft({ totpSecret: 'otpauth://totp/x?secret=abcd2345abcd2345&digits=7' }))).toThrow('位数')
      expect(() => store.add(draft({ totpSecret: 'otpauth://totp/x?secret=abcd2345abcd2345&algorithm=md5' }))).toThrow('算法')
    })

    it('update 编辑可更新参数；改裸 Base32 清除参数回落默认', () => {
      const created = store.add(draft({ totpSecret: 'otpauth://totp/x?secret=abcd2345abcd2345&period=60' }))
      const updated = store.update(
        created.id,
        draft({ totpSecret: 'otpauth://totp/x?secret=abcd2345abcd2345&period=120&digits=8&algorithm=SHA512' }),
      )
      expect(updated.totpPeriod).toBe(120)
      expect(updated.totpDigits).toBe(8)
      expect(updated.totpAlgorithm).toBe('SHA512')
      // 改贴裸 Base32 = 参数回落默认（normalizeDraft 三键恒存在，spread 覆盖清除）
      const cleared = store.update(created.id, draft({ totpSecret: 'abcd2345abcd2345' }))
      expect(cleared.totpSecret).toBe('ABCD2345ABCD2345')
      expect(cleared.totpPeriod).toBeUndefined()
      expect(cleared.totpDigits).toBeUndefined()
      expect(cleared.totpAlgorithm).toBeUndefined()
    })

    it('mergeEntries 透传备份独立参数字段（校验 + 默认归一 + 非法丢弃，F18）', () => {
      const base = { title: 'B', category: 'dev', url: '', username: '', password: '', notes: '', favorite: false }
      store.mergeEntries([
        { ...base, id: 'p1', createdAt: 1, updatedAt: 2, totpSecret: 'abcd2345abcd2345', totpPeriod: 60, totpDigits: 8, totpAlgorithm: 'SHA256' },
        { ...base, id: 'p2', createdAt: 1, updatedAt: 2, totpSecret: 'abcd2345abcd2345', totpPeriod: 30, totpDigits: 6, totpAlgorithm: 'SHA1' },
        { ...base, id: 'p3', createdAt: 1, updatedAt: 2, totpSecret: 'abcd2345abcd2345', totpPeriod: -5, totpDigits: 9, totpAlgorithm: 'MD5' as AccountEntry['totpAlgorithm'] },
      ])
      const by = (id: string) => store.list().find((e) => e.id === id)!
      expect(by('p1').totpPeriod).toBe(60)
      expect(by('p1').totpDigits).toBe(8)
      expect(by('p1').totpAlgorithm).toBe('SHA256')
      // 默认值归一为缺省
      expect(by('p2').totpPeriod).toBeUndefined()
      expect(by('p2').totpDigits).toBeUndefined()
      expect(by('p2').totpAlgorithm).toBeUndefined()
      // 非法值丢弃，秘钥本身保留
      expect(by('p3').totpSecret).toBe('ABCD2345ABCD2345')
      expect(by('p3').totpPeriod).toBeUndefined()
      expect(by('p3').totpDigits).toBeUndefined()
      expect(by('p3').totpAlgorithm).toBeUndefined()
    })
  })

  /** 以明文形式写入数据文件（绕过加密，模拟旧版本磁盘内容） */
  function writeRawStore(dir: string, entries: unknown[], version = 3): void {
    const meta = {
      version,
      encrypted: false,
      payload: JSON.stringify({ entries, savedAt: Date.now() }),
    }
    fs.writeFileSync(path.join(dir, 'vault.safebox'), JSON.stringify(meta), 'utf-8')
  }

  // 写盘失败回滚依赖 Windows ACL，其他平台跳过
  describe.skipIf(process.platform !== 'win32')('写盘失败回滚（icacls 模拟磁盘故障）', () => {
    const user = process.env.USERNAME ?? process.env.USER

    beforeEach(() => {
      if (!user) throw new Error('无法确定当前用户名')
    })

    afterEach(() => {
      if (user) {
        try {
          execSync(`icacls "${tmpDir}" /remove:d "${user}"`, { stdio: 'ignore' })
        } catch {
          // 权限可能尚未设置
        }
      }
    })

    it('写盘失败时内存回滚，磁盘保持最近一次成功内容', () => {
      store.add(draft({ title: 'T1' }))

      execSync(`icacls "${tmpDir}" /deny "${user}:(WD,AD)"`)
      try {
        expect(() => store.add(draft({ title: 'T2' }))).toThrow()
        // 内存回滚：条目数量不变
        expect(store.list()).toHaveLength(1)
        // 收藏状态回滚
        expect(() => store.toggleFavorite(store.list()[0].id)).toThrow()
        expect(store.list()[0].favorite).toBe(false)
        // 删除同样回滚
        expect(() => store.remove(store.list()[0].id)).toThrow()
        expect(store.list()).toHaveLength(1)
        // 磁盘保持 T1，不含未持久化的 T2
        const meta = JSON.parse(fs.readFileSync(path.join(tmpDir, 'vault.safebox'), 'utf-8'))
        const diskJson = meta.encrypted ? safeStorage.decryptString(Buffer.from(meta.payload, 'base64')) : meta.payload
        expect(diskJson).toContain('T1')
        expect(diskJson).not.toContain('T2')
      } finally {
        execSync(`icacls "${tmpDir}" /remove:d "${user}"`)
      }

      // 权限恢复后操作成功
      const t2 = store.add(draft({ title: 'T2' }))
      expect(store.list()).toHaveLength(2)
      expect(store.toggleFavorite(t2.id).favorite).toBe(true)
    })
  })

  /** 构造一条字段类型合法的磁盘条目 */
  function validEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: 'e1',
      title: 'GitHub',
      category: 'dev',
      url: '',
      username: 'u',
      password: 'p',
      notes: '',
      favorite: false,
      createdAt: 1,
      updatedAt: 2,
      ...overrides,
    }
  }

  describe('load() 逐条数据校验（读取侧损坏防护）', () => {
    it('坏条目被跳过，好条目保留，上报 repaired 状态与计数', () => {
      writeRawStore(tmpDir, [
        validEntry({ id: 'good1' }),
        validEntry({ id: 'bad-title', title: { nested: 'obj' } }),
        validEntry({ id: 'bad-fav', favorite: 'yes' }),
        validEntry({ id: 'good2', title: '邮箱' }),
        'not-an-object',
      ])
      const reloaded = new VaultStore(tmpDir)
      reloaded.load()
      expect(reloaded.getLoadStatus()).toEqual({ status: 'repaired', skipped: 3 })
      const list = reloaded.list()
      expect(list.map((e) => e.id)).toEqual(['good1', 'good2'])
      expect(list[0].title).toBe('GitHub')
    })

    it('全部条目合法时上报 ok，不误报 repaired', () => {
      writeRawStore(tmpDir, [validEntry(), validEntry({ id: 'e2', title: 'B' })])
      const reloaded = new VaultStore(tmpDir)
      reloaded.load()
      expect(reloaded.getLoadStatus()).toEqual({ status: 'ok' })
      expect(reloaded.list()).toHaveLength(2)
    })

    it('必备字段缺失（如无 id/createdAt）判为坏条目', () => {
      const missingId = validEntry()
      delete missingId.id
      const missingTs = validEntry({ id: 'e3' })
      delete missingTs.createdAt
      writeRawStore(tmpDir, [missingId, missingTs, validEntry({ id: 'ok' })])
      const reloaded = new VaultStore(tmpDir)
      reloaded.load()
      expect(reloaded.getLoadStatus()).toEqual({ status: 'repaired', skipped: 2 })
      expect(reloaded.list().map((e) => e.id)).toEqual(['ok'])
    })

    it('未知分类的合法条目归入 other 而非判坏', () => {
      writeRawStore(tmpDir, [validEntry({ category: 'hacker' })])
      const reloaded = new VaultStore(tmpDir)
      reloaded.load()
      expect(reloaded.getLoadStatus()).toEqual({ status: 'ok' })
      expect(reloaded.list()[0].category).toBe('other')
    })

    it('可选字段非法仅清除该字段，不连坐整条记录', () => {
      // deletedAt 非数字 → 视为未删除；totpSecret 非字符串 → 丢弃秘钥；条目本身保留
      writeRawStore(tmpDir, [
        validEntry({ id: 'e1', deletedAt: 'oops', totpSecret: 123 }),
      ])
      const reloaded = new VaultStore(tmpDir)
      reloaded.load()
      expect(reloaded.getLoadStatus()).toEqual({ status: 'ok' })
      const entry = reloaded.list()[0]
      expect(entry.deletedAt).toBeUndefined()
      expect(entry.totpSecret).toBeUndefined()
    })

    it('合法 deletedAt 与 totpSecret 原样保留', () => {
      writeRawStore(tmpDir, [validEntry({ id: 'e1', deletedAt: 999, totpSecret: 'ABCD2345' })])
      const reloaded = new VaultStore(tmpDir)
      reloaded.load()
      expect(reloaded.list()[0].deletedAt).toBe(999)
      expect(reloaded.list()[0].totpSecret).toBe('ABCD2345')
    })

    it('TOTP 参数读取校验：合法保留、非法丢弃、无秘钥时连带丢弃（F18）', () => {
      writeRawStore(tmpDir, [
        validEntry({ id: 'p1', totpSecret: 'ABCD2345', totpPeriod: 60, totpDigits: 8, totpAlgorithm: 'SHA256' }),
        validEntry({ id: 'p2', totpSecret: 'ABCD2345', totpPeriod: 9999, totpDigits: 7, totpAlgorithm: 'MD5' }),
        validEntry({ id: 'p3', totpPeriod: 60 }), // 无秘钥：参数无意义，连带丢弃
      ])
      const reloaded = new VaultStore(tmpDir)
      reloaded.load()
      const by = (id: string) => reloaded.list().find((e) => e.id === id)!
      expect(by('p1').totpPeriod).toBe(60)
      expect(by('p1').totpDigits).toBe(8)
      expect(by('p1').totpAlgorithm).toBe('SHA256')
      // 非法参数静默丢弃（不连坐秘钥与条目）
      expect(by('p2').totpSecret).toBe('ABCD2345')
      expect(by('p2').totpPeriod).toBeUndefined()
      expect(by('p2').totpDigits).toBeUndefined()
      expect(by('p2').totpAlgorithm).toBeUndefined()
      expect(by('p3').totpPeriod).toBeUndefined()
      expect(reloaded.getLoadStatus().status).toBe('ok')
    })

    it('entries 非数组时降级为空数据（ok，无跳过计数）', () => {
      writeRawStore(tmpDir, undefined as unknown as unknown[])
      const reloaded = new VaultStore(tmpDir)
      reloaded.load()
      expect(reloaded.getLoadStatus()).toEqual({ status: 'ok' })
      expect(reloaded.list()).toEqual([])
    })
  })

  describe('mergeDrafts（CSV 内容键去重导入）', () => {
    it('新增草稿落盘，重复内容（title+username 大小写不敏感）跳过', () => {
      store.add(draft({ title: 'GitHub', username: 'Me' }))
      const result = store.mergeDrafts([
        draft({ title: 'github', username: 'me' }), // 与已有条目内容重复
        draft({ title: 'New', username: 'u2' }),
        draft({ title: 'New', username: 'u2' }), // 同批内部重复仅保留第一条
      ])
      expect(result).toEqual({ imported: 1, skipped: 2 })
      expect(store.list()).toHaveLength(2)
    })

    it('非法草稿整体抛错并回滚内存（原子性）', () => {
      store.add(draft({ title: 'A' }))
      expect(() => store.mergeDrafts([draft({ title: 'B' }), draft({ title: '   ' })])).toThrow('请填写账号名称')
      expect(store.list()).toHaveLength(1)
    })

    it('CSV 来源的 otpauth 秘钥经 normalizeDraft 规范化落盘', () => {
      store.mergeDrafts([
        { ...draft({ title: 'X' }), totpSecret: 'otpauth://totp/X:u?secret=abcd2345ABCD2345&issuer=X' },
      ])
      expect(store.list()[0].totpSecret).toBe('ABCD2345ABCD2345')
    })
  })

  describe('passwordHistory（密码修改历史）', () => {
    it('修改密码时旧值压入历史（新→旧）', () => {
      const created = store.add(draft({ title: 'A', password: 'p1' }))
      store.update(created.id, draft({ title: 'A', password: 'p2' }))
      store.update(created.id, draft({ title: 'A', password: 'p3' }))
      const entry = store.list()[0]
      expect(entry.password).toBe('p3')
      expect(entry.passwordHistory).toHaveLength(2)
      expect(entry.passwordHistory?.[0].password).toBe('p2')
      expect(entry.passwordHistory?.[1].password).toBe('p1')
    })

    it('密码未变化 / 旧密码为空不产生历史', () => {
      const created = store.add(draft({ title: 'A', password: 'same' }))
      store.update(created.id, draft({ title: 'A', password: 'same', username: 'u' }))
      expect(store.list()[0].passwordHistory).toBeUndefined()
      const empty = store.add(draft({ title: 'B', password: '' }))
      store.update(empty.id, draft({ title: 'B', password: 'first' }))
      expect(store.list().find((e) => e.id === empty.id)?.passwordHistory).toBeUndefined()
    })

    it('超过 5 条时截断最旧', () => {
      const created = store.add(draft({ title: 'A', password: 'p0' }))
      for (let i = 1; i <= 7; i++) {
        store.update(created.id, draft({ title: 'A', password: `p${i}` }))
      }
      const history = store.list()[0].passwordHistory
      expect(history).toHaveLength(5)
      expect(history?.map((h) => h.password)).toEqual(['p6', 'p5', 'p4', 'p3', 'p2'])
    })

    it('历史随加密往返保留；磁盘 version 升 v6', () => {
      const created = store.add(draft({ title: 'A', password: 'p1' }))
      store.update(created.id, draft({ title: 'A', password: 'p2' }))
      const meta = JSON.parse(fs.readFileSync(path.join(tmpDir, 'vault.safebox'), 'utf-8'))
      // v6：TOTP 参数字段（F18）；load 不拦截版本，旧文件升级无缝兼容
      expect(meta.version).toBe(6)
      const reloaded = new VaultStore(tmpDir)
      reloaded.load()
      expect(reloaded.list()[0].passwordHistory?.[0].password).toBe('p1')
    })

    it('mergeEntries 透传合法历史并截断；结构非法条目剔除', () => {
      const base = { title: 'M', category: 'other', url: '', username: '', password: 'x', notes: '', favorite: false, createdAt: 1, updatedAt: 2 }
      // 故意混入结构非法的历史条目（password 非 string / 非对象），验证净化剔除
      const entries = [
        { ...base, id: 'm1', passwordHistory: [{ password: 'old', changedAt: 9 }] },
        { ...base, id: 'm2', passwordHistory: [{ password: 'ok', changedAt: 8 }, { password: 123 }, 'bad'] },
      ]
      store.mergeEntries(entries as unknown as import('../../shared/types').AccountEntry[])
      expect(store.list().find((e) => e.id === 'm1')?.passwordHistory).toEqual([{ password: 'old', changedAt: 9 }])
      expect(store.list().find((e) => e.id === 'm2')?.passwordHistory).toEqual([{ password: 'ok', changedAt: 8 }])
    })

    it('load 时 passwordHistory 结构非法条目剔除、合法保留', () => {
      writeRawStore(tmpDir, [
        validEntry({ id: 'e1', passwordHistory: [{ password: 'good', changedAt: 5 }, { nope: 1 }, null] }),
      ])
      const reloaded = new VaultStore(tmpDir)
      reloaded.load()
      expect(reloaded.getLoadStatus()).toEqual({ status: 'ok' })
      expect(reloaded.list()[0].passwordHistory).toEqual([{ password: 'good', changedAt: 5 }])
    })
  })
})
