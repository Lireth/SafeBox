import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { BackupModal } from '../../src/renderer/src/components/BackupModal'
import type { BackupExportResult, BackupImportResult, CsvExportResult, CsvImportResult } from '../../shared/types'

/** 渲染弹窗并返回可控的 props 替身（BackupModal 全部行为经 props 注入，无 window.safebox 依赖） */
function setup(options: { pinEnabled?: boolean } = {}) {
  const props = {
    onClose: vi.fn(),
    onExport: vi.fn<() => Promise<BackupExportResult>>(),
    onImport: vi.fn<() => Promise<BackupImportResult>>(),
    onImportCsv: vi.fn<() => Promise<CsvImportResult>>(),
    onExportCsv: vi.fn<(pin: string | undefined) => Promise<CsvExportResult>>(),
    pinEnabled: options.pinEnabled ?? false,
  }
  render(<BackupModal {...props} />)
  return props
}

const exportPwd1 = () => screen.getByPlaceholderText('导出口令（至少 8 个字符）')
const exportPwd2 = () => screen.getByPlaceholderText('确认导出口令')
const importPwd = () => screen.getByPlaceholderText('备份文件的口令')

describe('BackupModal 导出口令校验', () => {
  it('口令未填齐时导出按钮禁用', async () => {
    const user = userEvent.setup()
    setup()
    const btn = screen.getByRole('button', { name: '选择位置并导出' })
    expect(btn).toBeDisabled()
    await user.type(exportPwd1(), 'longenough')
    expect(btn).toBeDisabled()
    await user.type(exportPwd2(), 'longenough')
    expect(btn).toBeEnabled()
  })

  it('口令不足 8 位提示长度错误且不调用导出', async () => {
    const user = userEvent.setup()
    const props = setup()
    await user.type(exportPwd1(), '123')
    await user.type(exportPwd2(), '123')
    await user.click(screen.getByRole('button', { name: '选择位置并导出' }))
    expect(await screen.findByText('导出口令长度至少 8 个字符')).toBeInTheDocument()
    expect(props.onExport).not.toHaveBeenCalled()
  })

  it('两次口令不一致提示且不落盘', async () => {
    const user = userEvent.setup()
    const props = setup()
    await user.type(exportPwd1(), 'password1')
    await user.type(exportPwd2(), 'password2')
    await user.click(screen.getByRole('button', { name: '选择位置并导出' }))
    expect(await screen.findByText('两次输入的导出口令不一致')).toBeInTheDocument()
    expect(props.onExport).not.toHaveBeenCalled()
  })

  it('导出成功显示条数提示并清空口令', async () => {
    const user = userEvent.setup()
    const props = setup()
    props.onExport.mockResolvedValue({ canceled: false, path: 'C:/x.json', count: 5 })
    await user.type(exportPwd1(), 'password1')
    await user.type(exportPwd2(), 'password1')
    await user.click(screen.getByRole('button', { name: '选择位置并导出' }))
    expect(await screen.findByText('已导出 5 条账号，加密文件已保存到所选位置')).toBeInTheDocument()
    expect(exportPwd1()).toHaveValue('')
    expect(exportPwd2()).toHaveValue('')
    expect(props.onExport).toHaveBeenCalledWith('password1')
  })

  it('系统对话框取消时不显示提示且保留口令', async () => {
    const user = userEvent.setup()
    const props = setup()
    props.onExport.mockResolvedValue({ canceled: true })
    await user.type(exportPwd1(), 'password1')
    await user.type(exportPwd2(), 'password1')
    await user.click(screen.getByRole('button', { name: '选择位置并导出' }))
    await waitFor(() => expect(props.onExport).toHaveBeenCalled())
    expect(screen.queryByText(/已导出/)).toBeNull()
    expect(exportPwd1()).toHaveValue('password1')
  })

  it('导出失败显示主进程真实错误', async () => {
    const user = userEvent.setup()
    const props = setup()
    props.onExport.mockRejectedValue(new Error('应用已锁定，请先解锁'))
    await user.type(exportPwd1(), 'password1')
    await user.type(exportPwd2(), 'password1')
    await user.click(screen.getByRole('button', { name: '选择位置并导出' }))
    expect(await screen.findByText('应用已锁定，请先解锁')).toBeInTheDocument()
  })
})

describe('BackupModal 导入结果提示', () => {
  it('加密备份导入成功显示新增/跳过统计', async () => {
    const user = userEvent.setup()
    const props = setup()
    props.onImport.mockResolvedValue({ canceled: false, total: 10, imported: 6, skipped: 4 })
    await user.type(importPwd(), 'secretpw')
    await user.click(screen.getByRole('button', { name: '选择文件并导入' }))
    expect(
      await screen.findByText('导入完成：新增 6 条，跳过重复 4 条（文件共 10 条）。导入前的数据已自动备份。'),
    ).toBeInTheDocument()
    expect(importPwd()).toHaveValue('')
  })

  it('导入口令为空时按钮禁用', () => {
    setup()
    expect(screen.getByRole('button', { name: '选择文件并导入' })).toBeDisabled()
  })

  it('CSV 导入成功显示统计含忽略行数', async () => {
    const user = userEvent.setup()
    const props = setup()
    props.onImportCsv.mockResolvedValue({ canceled: false, total: 12, imported: 9, skipped: 2, invalid: 1 })
    await user.click(screen.getByRole('button', { name: '选择 CSV 文件并导入' }))
    expect(
      await screen.findByText('CSV 导入完成：新增 9 条，跳过重复 2 条，忽略无名称行 1 条（有效行共 12 条）。'),
    ).toBeInTheDocument()
    expect(props.onImportCsv).toHaveBeenCalled()
  })

  it('CSV 导入取消时不显示提示', async () => {
    const user = userEvent.setup()
    const props = setup()
    props.onImportCsv.mockResolvedValue({ canceled: true })
    await user.click(screen.getByRole('button', { name: '选择 CSV 文件并导入' }))
    await waitFor(() => expect(props.onImportCsv).toHaveBeenCalled())
    expect(screen.queryByText(/CSV 导入完成/)).toBeNull()
  })
})

describe('BackupModal 明文 CSV 导出强确认', () => {
  it('未确认前不触发导出', () => {
    const props = setup()
    expect(screen.getByRole('button', { name: '导出明文 CSV…' })).toBeInTheDocument()
    expect(props.onExportCsv).not.toHaveBeenCalled()
  })

  it('未启用 PIN：确认后直接导出（pin 传 undefined）并显示保管提示', async () => {
    const user = userEvent.setup()
    const props = setup({ pinEnabled: false })
    props.onExportCsv.mockResolvedValue({ canceled: false, path: 'C:/e.csv', count: 7 })
    await user.click(screen.getByRole('button', { name: '导出明文 CSV…' }))
    expect(await screen.findByText(/风险确认/)).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('锁定 PIN')).toBeNull()
    await user.click(screen.getByRole('button', { name: '我已了解风险，继续导出' }))
    await waitFor(() => expect(props.onExportCsv).toHaveBeenCalledWith(undefined))
    expect(await screen.findByText('已导出 7 条账号为明文 CSV。文件未加密，请妥善保管并尽快删除。')).toBeInTheDocument()
  })

  it('启用 PIN：未输入 PIN 时确认按钮禁用，输入后携带 PIN 导出', async () => {
    const user = userEvent.setup()
    const props = setup({ pinEnabled: true })
    props.onExportCsv.mockResolvedValue({ canceled: false, path: 'C:/e.csv', count: 3 })
    await user.click(screen.getByRole('button', { name: '导出明文 CSV…' }))
    const confirmBtn = screen.getByRole('button', { name: '我已了解风险，继续导出' })
    expect(confirmBtn).toBeDisabled()
    await user.type(screen.getByPlaceholderText('锁定 PIN'), '123456')
    expect(confirmBtn).toBeEnabled()
    await user.click(confirmBtn)
    await waitFor(() => expect(props.onExportCsv).toHaveBeenCalledWith('123456'))
  })

  it('取消强确认回到初始态，不触发导出', async () => {
    const user = userEvent.setup()
    const props = setup({ pinEnabled: true })
    await user.click(screen.getByRole('button', { name: '导出明文 CSV…' }))
    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.getByRole('button', { name: '导出明文 CSV…' })).toBeInTheDocument()
    expect(props.onExportCsv).not.toHaveBeenCalled()
  })

  it('保存对话框取消时不显示成功提示', async () => {
    const user = userEvent.setup()
    const props = setup({ pinEnabled: false })
    props.onExportCsv.mockResolvedValue({ canceled: true })
    await user.click(screen.getByRole('button', { name: '导出明文 CSV…' }))
    await user.click(screen.getByRole('button', { name: '我已了解风险，继续导出' }))
    await waitFor(() => expect(props.onExportCsv).toHaveBeenCalled())
    expect(screen.queryByText(/已导出.*明文 CSV/)).toBeNull()
  })

  it('PIN 错误时显示主进程真实错误并停留在确认态', async () => {
    const user = userEvent.setup()
    const props = setup({ pinEnabled: true })
    props.onExportCsv.mockRejectedValue(new Error('PIN 不正确'))
    await user.click(screen.getByRole('button', { name: '导出明文 CSV…' }))
    await user.type(screen.getByPlaceholderText('锁定 PIN'), '000000')
    await user.click(screen.getByRole('button', { name: '我已了解风险，继续导出' }))
    expect(await screen.findByText('PIN 不正确')).toBeInTheDocument()
    // 仍在确认态（可重试），未回退初始按钮
    expect(screen.getByRole('button', { name: '我已了解风险，继续导出' })).toBeInTheDocument()
  })
})
