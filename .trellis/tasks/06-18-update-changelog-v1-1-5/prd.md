# Update changelog V1.1.5

## Goal

将当前未提交的 UI 与交互改动整理到 `CHANGELOG.md` 的 `V1.1.5` 条目，方便发布记录保持完整。

## Requirements

* 在 `CHANGELOG.md` 顶部新增 `V1.1.5`，日期为 2026-06-18。
* 内容只描述当前变更，不修改功能代码、不升级包版本、不创建 tag。
* 按现有 changelog 中文分组格式书写，突出历史用量分析 UI、ccusage 统计 UI、主题色板与交互修复。

## Acceptance Criteria

* [ ] `CHANGELOG.md` 存在 `## [V1.1.5] - 2026-06-18`。
* [ ] 条目能覆盖当前 `git diff` 涉及的主要变更。
* [ ] 不改动除任务记录与 `CHANGELOG.md` 之外的业务文件。

## Definition of Done

* 直接检查 `CHANGELOG.md` 更新内容。
* 如无代码改动，不运行前端类型检查。

## Out of Scope

* 不修改 `package.json`、`Cargo.toml`、`tauri.conf.json` 等版本文件。
* 不提交、不打 tag、不启动桌面应用。

## Technical Notes

* 当前主要变更文件：`src/components/stats/StatsPanel.tsx`、`src/components/stats/CcusageStatsPanel.tsx`、`src/components/stats/statsPalette.ts`、`src/components/stats/TimelineHeatmap.tsx`、`src/components/stats/StatsHourlyActivityChart.tsx`、`src/App.css`、`src/components/sidebar/TreeNodeItem.tsx`、`src/main.tsx`。
* 未跟踪任务目录 `.trellis/tasks/06-18-history-usage-analysis-ui-redesign/` 的 PRD 描述了历史用量分析 Apple 风格改造目标。
