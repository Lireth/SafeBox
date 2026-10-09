import type { ElectronAPI } from '../../../shared/types'

declare global {
  interface Window {
    /** 由 preload 通过 contextBridge 注入 */
    safebox: ElectronAPI
  }
}

export {}
