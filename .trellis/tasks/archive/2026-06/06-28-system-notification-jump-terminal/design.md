# 系统级通知跳转终端设计

## Architecture

新增一条“系统通知目标激活”链路：

1. Hook bridge 继续接收 Claude/Codex 事件并 emit 给前端。
2. 前端处理 Hook 事件时解析 `tabId`，同时发送应用内 toast 与系统通知。
3. 系统通知发送时携带 `tabId` 与显示文案。
4. 用户点击系统通知后，后端将目标事件 emit 回前端。
5. 前端统一调用 `activateHookNotificationTarget(tabId)`：
   - 后端显示/取消最小化/聚焦主窗口；
   - 关闭历史工作区；
   - 激活终端 tab；
   - 若 tab 不存在，聚焦窗口并提示目标已关闭。

## Platform Plan

- Windows 原生：优先使用可等待 activation 的通知实现，能区分通知主体默认点击与 action 按钮。按钮文案使用当前事件的“查看/去处理”。
- WSL：保持由 Windows host 发送通知的桥接路径；本期如果无法可靠把 WSL host Toast activation 回送到前端，则保留展示并不破坏其他平台。后续可扩展为 deep link 或 host-side callback。
- macOS/Linux：使用可等待 action/click 的通知能力时走统一事件；平台不支持 action 时降级为展示通知。

## Contracts

前端新增目标结构：

```ts
interface SystemNotificationTarget {
  tabId: string;
}
```

后端新增/调整命令：

- `show_main_window`：显示并聚焦主窗口，供前端激活目标时调用。
- 系统通知发送命令携带 `title/body/tabId/actionLabel`，后端在通知点击时 emit `system-notification-action`。

## Trade-offs

- 不优先采用 `@tauri-apps/plugin-notification` action API，因为当前桌面插件源码未暴露 action registration 命令。
- 不在已关闭 tab 时自动打开历史详情，避免通知点击行为变成历史恢复流程。
- 运行时点击行为需要人工验收，自动化检查以类型与编译为主。

## Rollback

- 前端系统通知发送失败时继续静默降级，不影响应用内 toast 和 tab 状态。
- 后端新命令失败时前端可回退到现有 `sendNotification({ title, body })`。
