import { ipcRenderer } from 'electron'

// 在此处按需添加 ipcRenderer.invoke 等封装，保持渲染进程与 Node 解耦
export const electronAPI = {
  ipcRenderer: {
    invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args)
  },
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron
  }
}

export type ElectronAPI = typeof electronAPI
