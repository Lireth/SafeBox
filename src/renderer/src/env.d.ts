import type { ElectronAPI } from '../../../electron/api'

declare global {
  interface Window {
    /** 由 preload 通过 contextBridge 注入 */
    safebox: ElectronAPI
  }
}

export {}
