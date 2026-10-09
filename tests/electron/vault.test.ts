import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VaultStore } from '../../electron/vault'
import type { EntryDraft } from '../../shared/types'
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

    it('备份轮换：多次保存仅保留最近 3 份 .bak', () => {
      for (let i = 0; i < 5; i++) {
        store.add(draft({ title: `T${i}` }))
      }
      const baks = fs.readdirSync(tmpDir).filter((f) => f.includes('.bak-'))
      expect(baks).toHaveLength(3)
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
})
