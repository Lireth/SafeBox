import { contextBridge } from 'electron'
import { electronAPI } from './api'

// 通过 contextBridge 暴露类型化的安全 API
contextBridge.exposeInMainWorld('safebox', electronAPI)
