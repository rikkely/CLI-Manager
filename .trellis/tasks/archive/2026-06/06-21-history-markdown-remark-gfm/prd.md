# 使用 remark-gfm 优化历史 Markdown 渲染

## Goal

提升历史会话消息中的 Markdown 可读性，重点让 GitHub Flavored Markdown 内容（表格、任务列表、删除线、自动链接等）渲染得更完整、更清晰。

## What I Already Know

* 用户明确要求使用 `remark-gfm` 优化历史记录 Markdown 渲染。
* `remark-gfm` 已存在于 `package.json` 和 `package-lock.json`。
* 历史消息渲染入口是 `src/components/history/HistoryMarkdownContent.tsx`。
* 历史详情使用 `src/components/history/SessionDetailPane.tsx` 渲染消息，并调用 `HistoryMarkdownContent`。
* 当前工作区已有未提交改动，且 `HistoryMarkdownContent.tsx` 已接入 `remarkGfm`，`src/App.css` 已新增部分 Markdown 样式。

## Requirements

* Markdown 渲染必须抽成系统公共组件，不能继续绑定在 `history/` 模块内。
* 历史消息、Prompt 库、子 Agent 转录、更新说明统一使用公共 Markdown 组件。
* 公共 Markdown 渲染必须启用 `remark-gfm`。
* GFM 常见元素需要有明确样式：表格、任务列表 checkbox、删除线、引用、分隔线、标题、链接、代码块、脚注、图片占位。
* 搜索高亮仍需在文本节点中工作。
* HTML 继续禁用渲染，避免历史内容注入风险。
* 保留 `HistoryMarkdownContent` 兼容包装，避免旧引用断裂。

## Acceptance Criteria

* [x] 新增系统公共 `MarkdownContent` 组件。
* [x] 历史消息、Prompt 库、子 Agent 转录、更新说明统一使用公共 Markdown 组件。
* [x] `MarkdownContent` 使用 `remark-gfm` 渲染 Markdown 内容。
* [x] GFM 表格可横向滚动且表头/单元格可读。
* [x] 任务列表 checkbox 有稳定间距和视觉状态，不破坏列表布局。
* [x] 删除线、引用、标题、分隔线、链接、代码块、脚注、图片占位保持清晰样式。
* [x] `npm run build` 或至少 `npx tsc --noEmit` 通过。

## Definition of Done

* 前端类型检查通过。
* 不新增不必要依赖。
* 不改后端历史解析逻辑。
* 不覆盖用户已有未提交改动。

## Technical Approach

新增 `src/components/ui/MarkdownContent.tsx` 作为系统公共渲染组件，`src/components/history/HistoryMarkdownContent.tsx` 仅保留兼容包装；公共组件集中处理 `remark-gfm`、代码高亮、搜索高亮、链接行为和安全策略，样式统一使用 `ui-markdown` 命名。

## Out of Scope

* 不支持原始 HTML 渲染。
* 不新增 Markdown 编辑器。
* 不调整历史会话后端数据结构。
* 不重构历史工作区整体 UI。

## Technical Notes

* Frontend spec index: `.trellis/spec/frontend/index.md`
* Relevant files inspected:
  * `src/components/history/HistoryMarkdownContent.tsx`
  * `src/components/history/SessionDetailPane.tsx`
  * `src/App.css`
  * `package.json`
  * `package-lock.json`
