# Fix History List Alignment Separators

## Goal

修复会话历史窗口打开后列表项视觉错位的问题，并增强会话条目之间的分割感，让历史列表更容易扫描。

## What I already know

* 用户截图显示历史会话窗口左侧列表区域内，部分会话条目文本、元信息和操作按钮视觉上拥挤/错位。
* 用户反馈每个对话之间的分割不明显。
* 这是前端 UI 样式/布局问题，优先做最小范围修复。

## Assumptions (temporary)

* 不改变历史会话数据结构、筛选逻辑或后端解析逻辑。
* 只调整历史列表条目的布局、间距、边框/分割线和悬浮操作按钮展示。

## Requirements

* 按最小方案只修复截图中的会话列表条目，不改历史详情区布局。
* 历史会话列表项的标题、元信息、更新时间、条目操作按钮不能互相遮挡或错位。
* 相邻会话条目之间要有清晰但克制的分割。
* 每个会话历史条目支持右键菜单删除，复用现有删除确认链路。
* 每个会话历史条目右上角提供醒目的 `X` 删除入口。
* 保持现有筛选、选中、删除确认、跳转等行为不变。

## Acceptance Criteria (evolving)

* [ ] 打开会话历史窗口后，列表项内容在窄侧栏宽度下仍对齐稳定。
* [ ] 相邻会话条目之间可明显区分。
* [ ] Today/Yesterday 等时间分组标题与条目间距正常。
* [ ] 删除按钮不挤压标题和元信息。

## Definition of Done (team quality bar)

* 类型检查通过，或说明未运行原因。
* UI 可在浏览器/应用中验证，或说明无法验证原因。
* 不引入新依赖。

## Out of Scope (explicit)

* 不改历史搜索、Diff、收藏、标签、同步等业务逻辑。
* 不重做会话历史整体视觉风格。

## Technical Approach

只修改 `HistoryListPane` 的会话行虚拟高度和条目内部 Tailwind 布局类：提高固定估算高度，保证三行内容在窄侧栏中不会溢出；用卡片式边框/间距增强分割；复用全局 `.context-menu` 样式和现有 `onDeleteSession` 回调增加右键删除入口。

## Decision (ADR-lite)

**Context**: 截图中的问题集中在会话列表条目错位和分割弱，不需要改数据、搜索或详情区逻辑。  
**Decision**: 采用最小 UI 修复方案，仅调整会话列表条目的行高、间距、边框和按钮对齐。  
**Consequences**: 同屏可见条目数会略少；换来稳定对齐和更清晰分割。

## Technical Notes

* `HistoryListPane` 使用 `@tanstack/react-virtual`，`session` 行原估算高度为 76px。
* `ui-list-row` 全局样式只提供 hover 背景，条目自身高度和分割由组件 Tailwind 类决定。
* GitNexus impact: `HistoryListPane` 上游链路为 `HistoryWorkspace -> TerminalTabs -> App`，风险标记 HIGH；本任务仅改展示样式，不改 props、状态或数据流。
