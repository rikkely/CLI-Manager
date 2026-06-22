# Git diff UI style

## Goal

将 Git 变更面板打开的 diff 弹窗从偏通用应用的白色/灰色背景，调整为和右侧“Git 变更”面板一致的终端深色风格，减少视觉割裂。

## What I already know

* 用户指出：git 变更 diff 当前是白色背景，不好看，希望改成和 git 变更一样的风格 UI。
* Git 变更面板在 `src/components/git/GitChangesPanel.tsx`，使用 `TERM` 配色和 `font-mono`。
* diff 弹窗在 `src/components/git/DiffViewerModal.tsx`，当前大量使用 `bg-white` / `bg-gray-*` / `dark:*`。
* diff 细节样式在 `src/components/git/diffViewer.css`，当前同时保留亮色和暗色覆盖，亮色规则导致白色背景明显。
* Git 变更树在 `src/components/git/GitTreeNode.tsx`，同样使用 `TERM` 配色。

## Assumptions (temporary)

* 本次只统一 Git 变更入口的 diff 弹窗，不调整历史记录里的 `DiffModal`。
* 保留现有 split diff、加载、错误和空内容行为，只改视觉样式。
* 不新增依赖，不改后端 diff 获取逻辑。

## Open Questions

* MVP 是否只做当前 Git 变更 diff 弹窗的最小视觉统一？

## Requirements (evolving)

* diff 弹窗背景、边框、文字、按钮、加载/错误/空态改为 `TERM` 终端风格。
* `react-diff-view` 的 gutter/code/hunk/header/insert/delete 样式改为深色终端风格。
* 避免继续出现白色 diff 背景。

## Acceptance Criteria (evolving)

* [ ] 从 Git 变更面板点击文件打开 diff 时，弹窗整体为深色终端风格。
* [ ] 普通行、行号区、hunk header、新增/删除行均不出现白色背景。
* [ ] 加载、错误、无 diff 内容状态仍正常显示。
* [ ] TypeScript 类型检查通过。

## Definition of Done (team quality bar)

* Tests added/updated where appropriate; UI-only样式调整如无现有测试可不新增测试。
* `npx tsc --noEmit` 通过或如失败需如实报告。
* 不修改无关功能、不新增依赖。
* 如只能人工确认视觉效果，明确说明。

## Out of Scope (explicit)

* 不重做 diff 解析逻辑。
* 不改变 split/unified 展示模式。
* 不调整历史记录 diff 弹窗。
* 不新增主题系统或用户配置项。

## Technical Notes

* Inspected `src/components/git/DiffViewerModal.tsx`。
* Inspected `src/components/git/diffViewer.css`。
* Inspected `src/components/git/GitChangesPanel.tsx`。
* Inspected `src/components/git/GitTreeNode.tsx`。
* Inspected `src/components/stats/termStatsUi.tsx` for `TERM` palette。
* `gitnexus_impact` with target `DiffViewerModal` returned `Target 'DiffViewerModal' not found`; need retry with exact indexed target/file before editing.
