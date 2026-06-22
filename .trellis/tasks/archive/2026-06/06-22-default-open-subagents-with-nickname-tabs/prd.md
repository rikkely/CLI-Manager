# 默认打开子任务并使用昵称作为 Tab 名称

## Goal

收到 CLI `SubagentStart` 事件时，CLI-Manager 应自动显示对应子任务转录 Tab，并让 Tab 名称优先使用用户可读的子任务名称/昵称，例如 `Poincare`、`Euler`，而不是只显示通用的 `子 Agent` 或难读的 Agent ID。

## What I Already Know

* 用户示例包含子任务 A/B、Agent ID、昵称三列；期望 Tab 名称使用昵称。
* 当前前端在 `src/stores/terminalStore.ts` 的 `openSubagentTranscript` 中创建 `kind: "subagent-transcript"` 伪会话。
* 当前标题逻辑是 `agentType ? "子 Agent · <agentType>" : "子 Agent"`。
* `src/components/TerminalTabs.tsx` 和 `SubagentTranscriptView` 已经通过 `session.title` 渲染 Tab/转录标题，预计无需改组件。
* Hook 合同 `.trellis/spec/backend/cli-hook-contracts.md` 当前只声明 `agentId`、`agentType`、`agentTranscriptPath` / `transcriptPath`，没有单独 `nickname` 字段。

## Assumptions

* 示例中的昵称 `Poincare` / `Euler` 对应当前 payload 中的 `agentType`，除非后续确认存在独立 nickname/name 字段。
* “默认打开子任务”指收到 `SubagentStart` 后自动创建/显示子任务转录 Tab；现有逻辑已经创建分屏与 Tab，但不抢主终端焦点。

## Open Questions

* None.

## Requirements

* 子任务转录 Tab 的标题应优先使用可读名称/昵称。
* 收到 `SubagentStart` 后自动显示子任务转录 Tab，但不抢主终端焦点。
* 没有可读名称时，仍保留稳定 fallback，不能显示空标题。
* 不改变现有 `agentId` 去重、订阅、停止关闭逻辑。
* 不引入新依赖。

## Acceptance Criteria

* [x] `SubagentStart` payload 带 `agentType: "Poincare"` 时，新建转录 Tab 标题显示为 `Poincare`。
* [x] `SubagentStart` payload 带 `agentType: "Euler"` 时，新建转录 Tab 标题显示为 `Euler`。
* [x] 缺少可读名称时，标题仍显示为 `子 Agent` 或等价 fallback。
* [x] 同一 `agentId` 重复事件仍复用已有转录 Tab，不创建重复 Tab。
* [x] 新子任务 Tab 创建后，当前主终端仍保持激活状态。
* [x] `npx tsc --noEmit` 通过。

## Definition of Done

* 相关代码遵循现有 Zustand store 和 pane tree 模式。
* TypeScript 类型检查通过。
* 如涉及 Rust hook payload 字段变化，补跑 `cd src-tauri && cargo check`。

## Out of Scope

* 不新增子任务管理列表。
* 不重构 pane/tree/tab 架构。
* 不新增依赖或设置项。
* 不改变历史会话持久化规则；`subagent-transcript` 仍为非持久化伪会话。

## Technical Notes

* 候选文件：`src/stores/terminalStore.ts`。
* 可能相关但预计无需修改：`src/lib/types.ts`、`src/components/TerminalTabs.tsx`、`src/components/terminal/SubagentTranscriptView.tsx`。
* 如果确认需要独立 `nickname` 字段，则需同步修改 `src-tauri/src/hook_client.rs`、`src-tauri/src/claude_hook.rs`、`src/stores/terminalStore.ts`、`src/lib/types.ts` 和 hook 合同。
* 用户已确认“默认打开”采用不抢焦点方案：只自动显示子任务转录 Tab，保持当前终端输入焦点。
