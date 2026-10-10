import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PASSWORD_VISIBLE_MS, useAutoHide } from '../../src/renderer/src/lib/useAutoHide'

afterEach(() => {
  vi.useRealTimers()
})

describe('useAutoHide（限时暴露 hook，O25 收编）', () => {
  it('初始隐藏；show 后 PASSWORD_VISIBLE_MS 到期自动隐藏', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useAutoHide())
    expect(result.current.visible).toBe(false)

    act(() => result.current.show())
    expect(result.current.visible).toBe(true)

    act(() => vi.advanceTimersByTime(PASSWORD_VISIBLE_MS - 1))
    expect(result.current.visible).toBe(true)
    act(() => vi.advanceTimersByTime(1))
    expect(result.current.visible).toBe(false)
  })

  it('隐藏→再显示循环：每次变为可见都重新计时（issue #26 语义）', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useAutoHide())
    // 第一轮：显示 → 快到期 → 隐藏
    act(() => result.current.show())
    act(() => vi.advanceTimersByTime(PASSWORD_VISIBLE_MS))
    expect(result.current.visible).toBe(false)
    // 第二轮：重新显示 → 计时从头开始
    act(() => result.current.show())
    act(() => vi.advanceTimersByTime(PASSWORD_VISIBLE_MS - 1))
    expect(result.current.visible).toBe(true)
    act(() => vi.advanceTimersByTime(1))
    expect(result.current.visible).toBe(false)
  })

  it('hide 立即隐藏且定时器清理（到期不重复触发）', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useAutoHide())
    act(() => result.current.show())
    act(() => result.current.hide())
    expect(result.current.visible).toBe(false)
    // 原定时器已清理：推进到原到期点不会产生状态变化
    act(() => vi.advanceTimersByTime(PASSWORD_VISIBLE_MS + 1000))
    expect(result.current.visible).toBe(false)
  })

  it('toggle 在显示 / 隐藏间切换', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useAutoHide())
    act(() => result.current.toggle())
    expect(result.current.visible).toBe(true)
    act(() => result.current.toggle())
    expect(result.current.visible).toBe(false)
  })
})
