import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Modal } from '../../src/renderer/src/components/Modal'

afterEach(() => {
  cleanup()
})

/** 可聚焦元素（含 modal-header 关闭按钮） */
function focusables(): HTMLElement[] {
  const dialog = screen.getByRole('dialog')
  return Array.from(dialog.querySelectorAll<HTMLElement>('button, input'))
}

describe('Modal dialog 语义（O21）', () => {
  it('role=dialog + aria-modal；有 title 时 aria-labelledby 指向标题元素', () => {
    render(
      <Modal title="测试弹窗" onClose={() => {}}>
        <input />
      </Modal>,
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    const labelledBy = dialog.getAttribute('aria-labelledby')
    expect(labelledBy).toBeTruthy()
    expect(document.getElementById(labelledBy as string)?.textContent).toBe('测试弹窗')
  })

  it('无 title 时使用 ariaLabel 作为可访问名称', () => {
    render(
      <Modal ariaLabel="删除确认" onClose={() => {}}>
        <input />
      </Modal>,
    )
    expect(screen.getByRole('dialog', { name: '删除确认' })).toBeInTheDocument()
  })
})

describe('Modal 初始聚焦（O21）', () => {
  it('弹窗内无已聚焦元素时，容器（tabIndex=-1）获得焦点', () => {
    render(
      <Modal title="测试" onClose={() => {}}>
        <input />
      </Modal>,
    )
    expect(document.activeElement).toBe(screen.getByRole('dialog'))
  })

  it('子组件已自动聚焦时不覆盖（EntryFormModal 聚焦标题框的场景）', () => {
    render(
      <Modal title="测试" onClose={() => {}}>
        <input id="auto" autoFocus />
      </Modal>,
    )
    expect(document.activeElement).toBe(document.getElementById('auto'))
  })
})

describe('Modal focus trap（O21）', () => {
  it('焦点在最后一个可聚焦元素时按 Tab 回到第一个（modal-header 关闭按钮）', () => {
    render(
      <Modal title="trap" onClose={() => {}}>
        <input id="field-first" />
        <button type="button" id="btn-last">
          最后
        </button>
      </Modal>,
    )
    const list = focusables()
    const first = list[0] // 关闭按钮
    const last = list[list.length - 1]
    last.focus()
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(document.activeElement).toBe(first)
  })

  it('Shift+Tab 在第一个可聚焦元素时跳到最后一个', () => {
    render(
      <Modal title="trap" onClose={() => {}}>
        <input id="field-first" />
        <button type="button" id="btn-last">
          最后
        </button>
      </Modal>,
    )
    const list = focusables()
    const first = list[0]
    const last = list[list.length - 1]
    first.focus()
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
  })

  it('无 title 弹窗（无关闭按钮）时，Tab 循环覆盖全部子元素', () => {
    render(
      <Modal ariaLabel="无标题" onClose={() => {}}>
        <input id="field-first" />
        <button type="button" id="btn-last">
          最后
        </button>
      </Modal>,
    )
    document.getElementById('btn-last')?.focus()
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(document.activeElement).toBe(document.getElementById('field-first'))
  })

  it('焦点被程序性移出弹窗时，按 Tab 强制拉回弹窗内第一个', () => {
    render(
      <Modal title="trap" onClose={() => {}}>
        <input id="field-first" />
      </Modal>,
    )
    // blur 后 activeElement 落到 body（弹窗外）
    ;(document.activeElement as HTMLElement).blur()
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(false)
    fireEvent.keyDown(window, { key: 'Tab' })
    const list = focusables()
    expect(list).toContain(document.activeElement as HTMLElement)
    expect(document.activeElement).toBe(list[0])
  })
})

describe('Modal 关闭归还焦点（O21）', () => {
  it('先聚焦触发按钮再挂载 Modal，卸载后焦点归还', () => {
    const shell = render(
      <button type="button" id="opener">
        外部按钮
      </button>,
    )
    const opener = document.getElementById('opener') as HTMLElement
    opener.focus()
    expect(document.activeElement).toBe(opener)

    const modal = render(
      <Modal title="归还" onClose={() => {}}>
        <input id="in-modal" />
      </Modal>,
    )
    // 挂载后焦点进入弹窗
    expect(document.activeElement).not.toBe(opener)
    // 关闭（卸载）后归还
    modal.unmount()
    expect(document.activeElement).toBe(opener)
    shell.unmount()
  })

  it('打开前的焦点元素已被移除时，卸载不抛错也不归还到游离节点', () => {
    const shell = render(
      <button type="button" id="doomed">
        即将消失
      </button>,
    )
    ;(document.getElementById('doomed') as HTMLElement).focus()
    const modal = render(
      <Modal title="x" onClose={() => {}}>
        <input />
      </Modal>,
    )
    shell.unmount() // 触发元素先于 Modal 卸载
    expect(() => modal.unmount()).not.toThrow()
  })
})

describe('Modal Esc 关闭（既有行为回归）', () => {
  it('按 Esc 调用 onClose', () => {
    const onClose = vi.fn()
    render(
      <Modal title="esc" onClose={onClose}>
        <input />
      </Modal>,
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
