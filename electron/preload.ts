import { contextBridge } from 'electron'
import { electronAPI } from './api'

// 通过 contextBridge 暴露安全的渲染进程 API
contextBridge.exposeInMainWorld('electronAPI', electronAPI)
