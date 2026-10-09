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

    it('remove 删除条目，重复删除抛错', () => {
      const created = store.add(draft())
      store.remove(created.id)
      expect(store.list()).toEqual([])
      expect(() => store.remove(created.id)).toThrow('账号不存在')
    })

    it('toggleFavorite 在 false 与 true 间切换', () => {
      const created = store.add(draft())
      expect(store.toggleFavorite(created.id).favorite).toBe(true)
      expect(store.toggleFavorite(created.id).favorite).toBe(false)
      expect(() => store.toggleFavorite('no-such-id')).toThrow('账号不存在')
    })
  })

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
