import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/global.css'

// ---- 渲染端未捕获异常采集（O32）----
// 必须在主世界（渲染端入口）注册：error/unhandledrejection 等脚本引擎级事件
// 按隔离世界派发，沙箱 preload（隔离世界）收不到主世界的异常（冒烟实证）。
// 上报经主进程 logger 统一脱敏后进入诊断日志，补齐 #35 只覆盖主进程的盲区。
const ERROR_MSG_MAX = 500
const ERROR_STACK_MAX = 2000

function clip(value: string | undefined, max: number): string | undefined {
  if (!value) return undefined
  return value.length > max ? `${value.slice(0, max)}…` : value
}

function report(message: string, stack?: string): void {
  // fire-and-forget：上报自身失败不影响主流程（handler 恒成功，理论不 reject）
  void window.safebox.reportRendererError(clip(message, ERROR_MSG_MAX) ?? message, clip(stack, ERROR_STACK_MAX))
}

window.addEventListener('error', (event) => {
  const location = event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : undefined
  const err: unknown = event.error
  report(event.message || '未知渲染端异常', location ?? (err instanceof Error ? err.stack : undefined))
})

window.addEventListener('unhandledrejection', (event) => {
  const reason: unknown = event.reason
  report(
    `Unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`,
    reason instanceof Error ? reason.stack : undefined,
  )
})

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
