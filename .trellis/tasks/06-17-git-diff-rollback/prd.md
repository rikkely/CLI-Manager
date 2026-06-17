# Git diff rollback (回滚未提交改动)

## Goal

在 Git 变更面板与 diff 弹窗中，让用户能**回滚（丢弃）未提交的改动**，粒度覆盖：整文件 / 单个 hunk / 选中的行。回滚后工作区恢复到 HEAD 对应内容。并修复"面板不自动刷新、仅打开时拉一次"的问题。全程纯 libgit2 实现，不调命令行 git。

## What I already know (调研结论)

* 后端 `src-tauri/src/commands/git.rs` 全用 **git2 0.19.0**（libgit2 1.8.1），目前**纯只读**：`get_current_git_branch` / `git_get_changes` / `git_get_file_diff`。命令在 `lib.rs:322-324` 经 `generate_handler!` 注册（自定义命令无需额外 capability）。
* 项目刻意避开命令行 git（`git.rs` 注释：用 libgit2 防安全软件弹窗）→ 回滚也必须用 git2。
* git2 0.19 已确认支持：`Repository::apply(&Diff, ApplyLocation::WorkDir, Option<&mut ApplyOptions>)`、`Diff::from_buffer(&[u8])`、`ApplyOptions::check(bool)`（dry-run）、`hunk_callback`。
* 文件级回滚可用 `reset_default` + `checkout_head(CheckoutBuilder::force().path())`，比 patch 更稳（尤其 `D` 删除恢复）。
* 前端 `gitStore` 仅 `fetchChanges`；`GitChangesPanel.tsx:18-24` 的 useEffect 只在 `open`/`projectPath` 变化时拉一次，**无轮询、无 focus 监听**（即用户报告的不自动刷新）；`GitTreeNode` 文件节点有 hover 高亮、点击开 diff，**无右键/无操作按钮**；`DiffViewerModal` 是只读 split diff（react-diff-view 已解析出 hunks/tokens）。
* diff 文本格式：`git_get_file_diff` 返回标准 unified diff；未跟踪文件(U/??)是后端手工拼的「全新增」diff。

## Decisions (用户已拍板)

* **粒度**：文件级 + Hunk 级 + 行级（全做）。
* **入口**：文件树 hover 按钮 + diff 弹窗顶部按钮 + 文件树右键菜单（三处都要）。
* **未跟踪文件(U/??)**：排除，不提供回滚（最安全，避免误删用户新写代码）。
* **批量**：做「丢弃全部」一键回滚（面板顶部），需二次强确认。
* **自动刷新**：聚焦时轮询 —— 面板可见且窗口聚焦时每 ~4s **静默**刷新（不闪 loading），失焦/隐藏暂停。

## Solution Outline

### 后端（git.rs 新增 2 个写命令）

1. `git_discard_file(project_path, file_path, status)` — 文件级回滚（「全部回滚」逐文件复用）
   * `M`：`reset_default(HEAD, [path])` 取消暂存 → `checkout_head(force, path)` 还原工作区。
   * `D`：同上，checkout_head 从 HEAD 恢复被删文件。
   * `A`（已暂存新增）：`reset_default` 取消暂存（变为 untracked），**不删物理文件**（与"排除未跟踪"一致）。
   * `U`/`??`：直接拒绝并返回明确错误。
   * `R`：MVP 按 M 处理（恢复原文件）。
   * 边界：path 不含 `..`、必须落在 repo 内；操作包在 `spawn_blocking`。

2. `git_apply_patch(project_path, reverse_patch)` — hunk/行级回滚
   * `Diff::from_buffer(reverse_patch.as_bytes())` 解析前端组装的**反向 patch**。
   * 先 `ApplyOptions::check(true)` dry-run；失败 → 返回"工作区已变化，请刷新后重试"，**不破坏现场**。
   * 通过后正式 `apply(WorkDir)`。

### 前端

1. `src/lib/diffPatch.ts`（新增，纯函数 + 单测）：把 react-diff-view 的 hunks + 选中项 → **反向 unified patch**。
   * Hunk 级：选中整个 hunk，交换 +/- 并对调 header 的 old/new。
   * 行级：选中行反向（+→-、-→+）；未选中的 `+` 行降级为上下文行；未选中的 `-` 行丢弃；**重算 hunk header 行数**。
   * 边界：CRLF、`\ No newline at end of file`、多 hunk。
2. `gitStore`：新增 `discardFile` / `applyReversePatch` / `discardAll`，成功后刷新 + 关闭失效 diff 弹窗；`fetchChanges` 增加 `silent` 模式（轮询时不 set loading 避免闪烁）。
3. `GitChangesPanel`：面板可见 + 窗口聚焦时 `setInterval(~4s)` 静默刷新；监听 `visibilitychange`/window `focus`/`blur` 启停；卸载/关闭清理。
4. 三处入口：
   * `GitTreeNode`：hover 时显示 `↩`（lucide `Undo2`）按钮；U/?? 不显示。
   * `GitFileContextMenu`（新增轻量右键菜单组件）：含「回滚改动」。
   * `DiffViewerModal`：Header「回滚此文件」；每个 hunk 旁「回滚此块」；行选择 + 底部「回滚选中 N 行」操作条。
5. `ConfirmDialog`（复用/新增）：破坏性二次确认，文案明确"永久丢弃、无法 git 撤销"；全部回滚显示受影响文件数。

## Requirements (evolving)

* 文件级：从 hover 按钮 / 右键 / diff 弹窗均可回滚单个已跟踪文件(M/D)。
* Hunk 级：diff 弹窗内可回滚单个变更块。
* 行级：diff 弹窗内可选中若干行并回滚。
* 批量：面板顶部「丢弃全部」回滚所有已跟踪改动。
* 未跟踪文件不出现回滚入口（或禁用 + tooltip 说明）。
* 所有回滚前二次确认；回滚后自动刷新变更列表。
* 面板打开且窗口聚焦时自动轮询刷新，反映外部改动。

## Acceptance Criteria (evolving)

* [ ] 文件级：M/D 文件回滚后从变更列表消失，工作区内容 == HEAD。
* [ ] Hunk 级：仅选中 hunk 被撤销，其余改动保留。
* [ ] 行级：仅选中行被撤销，同 hunk 未选中行保留。
* [ ] 未跟踪文件无回滚入口；点「全部」不波及未跟踪文件。
* [ ] 工作区在打开 diff 后被外部改动时，hunk/行回滚 dry-run 失败并友好提示，不损坏文件。
* [ ] 每次回滚均有二次确认；「全部」有更强警示。
* [ ] 面板打开且窗口聚焦时，外部产生的改动 ~4s 内自动出现；刷新静默不闪烁；失焦/隐藏停止轮询。
* [ ] `npx tsc --noEmit` 通过；`cargo check` 通过；`diffPatch.ts` 单测通过。

## Definition of Done

* `diffPatch.ts` 反向 patch 逻辑必须有单元测试（行级重算是最高风险点）。
* `npx tsc --noEmit` 与 `cd src-tauri && cargo check` 通过，失败如实报告。
* 不引入未跟踪文件删除能力；不改命令行 git 策略；不新增重依赖（右键菜单/确认弹窗用自有轻量组件）。
* 桌面 UI 实际观感（hover 按钮、行选择交互、右键菜单定位、轮询不打断）需人工验收，明确说明。

## Phases (建议分阶段交付，各自可独立验证)

* **P1 文件级 + 自动刷新**：`git_discard_file` + gitStore + 三处入口的「整文件回滚」+ 确认弹窗 + 「丢弃全部」+ 面板聚焦轮询静默刷新。覆盖主场景，先可用。
* **P2 Hunk 级**：`diffPatch.ts`(hunk) + 单测 + `git_apply_patch` + diff 弹窗「回滚此块」。
* **P3 行级**：`diffPatch.ts` 扩展到行级 + 行选择 UI + 单测。

## Open Questions

* 行选择交互方式：逐行点选 vs 框选 vs gutter 复选框？react-diff-view 行级可交互能力待 P3 实现期验证。
* 「全部回滚」是否也提供"仅回滚当前筛选(M/A/D)"的范围，还是固定全部已跟踪改动？（暂定固定全部已跟踪改动）

## Out of Scope

* 不回滚/删除未跟踪文件。
* 不做 stage/unstage 的完整暂存区管理 UI（仅回滚内部按需 reset）。
* 不做 commit/revert（针对已提交历史）的回滚。
* 不改 diff 解析与 split/unified 展示逻辑（仅在其上叠加选择/操作）。
* 不调命令行 git。

## Technical Notes

* git2 apply 方向：libgit2 的 `apply` 是「正向应用」。要"撤销"改动 → 前端组装**反向 patch**（即 workdir→HEAD 方向），正向 apply 即等于回滚。
* 反向 patch 行级规则（实现依据）：
  * 原 `-` 行（HEAD 有、workdir 无）→ 选中则反向为 `+`（恢复）；未选中则从反向 patch 中省略。
  * 原 `+` 行（workdir 有、HEAD 无）→ 选中则反向为 `-`（删除）；未选中则保留为上下文 ` ` 行（因 workdir 仍存在，需用于对齐）。
  * 上下文行原样保留。
  * hunk header `@@ -oldStart,oldCount +newStart,newCount @@` 需按反向后的实际行数重算。
* 文件级走 checkout 而非 patch：对 `D`（删除恢复）、二进制、大改动更稳，不依赖文本 patch 正确性。
* dry-run（`ApplyOptions::check(true)`）是 hunk/行回滚的安全闸门，防止 stale diff 应用到已变动的工作区。
* 自动刷新用聚焦轮询而非文件系统 watch：实现简单、无原生 watcher 依赖；`silent` 刷新避免每 4s 闪 loading spinner。
* 已确认 git2 0.19 API：`Repository::apply` / `Diff::from_buffer` / `ApplyLocation::WorkDir` / `ApplyOptions::{check,hunk_callback}`（context7 docs.rs/git2）。
