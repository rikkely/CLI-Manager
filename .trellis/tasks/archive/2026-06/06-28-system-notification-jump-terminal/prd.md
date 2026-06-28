# 系统级别通知点击跳转终端

## Goal

让 Claude/Codex Hook 触发的系统级别通知具备可处理能力：用户从 Windows/macOS/Linux 系统通知点击后，CLI-Manager 应回到前台并定位到对应的会话终端，行为尽量复用应用内 Hook toast 的“查看/去处理”逻辑。

## User Value

- 用户离开 CLI-Manager 或窗口最小化时，仍可从系统通知直接回到需要处理的 Claude/Codex 终端。
- PermissionRequest、StopFailure、Notification 等事件不再只是一条系统提醒，而是能带用户回到上下文。
- 保持 Windows、macOS、Linux 能力差异透明，避免承诺某个平台通知中心不稳定支持的按钮能力。

## Confirmed Facts

- 当前应用内 Hook toast 已支持“查看/去处理”，实现为关闭历史面板并调用 `useTerminalStore.getState().setActive(tabId)`。
- 当前系统通知在 `src/App.tsx` 中通过 `@tauri-apps/plugin-notification` 发送，仅传 `title/body`，没有携带可激活目标。
- Hook payload 已包含定位终端所需的 `tabId`，部分事件还包含 `source/sessionId/cwd/timestamp`。
- Tauri 后端已有 `show_main_window`，可 show/unminimize/focus 主窗口。
- WSL 通知目前通过 `send_notification_via_windows` 走 Windows host PowerShell Toast 兜底。
- `tauri-plugin-notification 2.3.3` 的桌面插件能力主要是基础 notify/permission；JS 层 action API 不能直接作为三端桌面可靠交互方案。

## Requirements

1. 系统通知发送时必须携带可定位目标，至少包含 `tabId`，并保留足够的事件上下文用于调试和降级。
2. 点击系统通知后，CLI-Manager 必须：
   - 显示主窗口；
   - 取消最小化；
   - 聚焦主窗口；
   - 切回终端工作区；
   - 激活对应 `tabId`。
3. 应用内 Hook toast 和系统通知点击应复用同一个“激活 Hook 通知目标”入口，避免行为分叉。
4. Windows 原生环境应优先支持可点击通知；如实现成本可控，通知内提供“处理/查看”按钮。
5. WSL 场景应继续通过 Windows host 系统通知桥发送通知，并尽量复用同一激活目标。
6. macOS/Linux 应至少支持点击通知主体后的窗口激活与终端定位；如果平台通知 action 不可靠，应明确降级为点击主体或仅应用聚焦。
7. 未授予系统通知权限、系统通知发送失败、通知点击目标不存在时，不得影响 Hook 事件处理、应用内 toast、标签状态圆点和实时统计绑定。
8. 新增用户可见文案必须同步 zh-CN 与 en-US。

## Acceptance Criteria

- [ ] 有活动终端 tab 收到 PermissionRequest 系统通知后，点击系统通知能唤起 CLI-Manager 并切到该 tab。
- [ ] 同一事件的应用内 toast 按钮与系统通知点击使用一致的激活逻辑。
- [ ] Windows 原生环境下，系统通知可携带“处理/查看”能力；不可用时至少点击通知主体可跳转。
- [ ] WSL 触发的 Hook 系统通知不回退为无目标通知；能携带 `tabId` 或有清晰降级。
- [ ] macOS/Linux 不因平台 action 能力不足而报错；至少保持通知展示与应用内 toast 正常。
- [ ] `npx tsc --noEmit` 通过。
- [ ] `cd src-tauri && cargo check` 通过。

## Out of Scope

- 不修改 Claude/Codex Hook 安装协议或全局配置格式，除非实现证明必须补充字段。
- 不实现跨应用重启后恢复并跳转到已不存在的运行中 PTY。
- 不重构系统通知设置页。
- 不启动 Tauri 桌面窗口做人工 UI 验收；提供手动验收步骤。

## Open Question

- 已决策：当通知对应的终端 tab 已关闭时，本期只聚焦 CLI-Manager 并提示目标终端已关闭，不自动打开历史会话详情。

## Decisions

- 系统通知点击的 MVP 目标是回到仍在运行/存在的终端 tab。
- 已关闭终端不自动打开历史详情，避免把本期范围扩大到历史索引加载、历史会话定位与“继续对话”语义。
- 对较旧通知点击的降级行为：窗口回到前台，前端显示目标已不存在的提示。
