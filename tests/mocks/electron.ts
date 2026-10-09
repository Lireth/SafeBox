/**
 * electron 模块替身（经 vitest.config.ts 的 resolve.alias 指向本文件）。
 * 仅覆盖主进程代码实际用到的 API，行为需与真实环境语义一致：
 * - safeStorage：加解密必须对称（以 "enc:" 前缀模拟不可逆外观）
 * - powerMonitor / BrowserWindow：通过 mockState 控制行为
 */

/** 可控状态：测试用例中直接修改以驱动行为 */
export const mockState = {
  /** powerMonitor.getSystemIdleTime() 的返回值（秒） */
  idleSeconds: 0
}

export const safeStorage = {
  isEncryptionAvailable: (): boolean => true,
  /** 模拟加密：附加前缀，保证密文不等于明文且可对称解密 */
  encryptString: (plain: string): Buffer => Buffer.from(`enc:${plain}`, 'utf-8'),
  decryptString: (buffer: Buffer): string => {
    const text = buffer.toString('utf-8')
    if (!text.startsWith('enc:')) throw new Error('解密失败')
    return text.slice(4)
  }
}

export const powerMonitor = {
  getSystemIdleTime: (): number => mockState.idleSeconds
}

export const BrowserWindow = {
  /** 锁定广播时无窗口即跳过 */
  getAllWindows: (): unknown[] => []
}
