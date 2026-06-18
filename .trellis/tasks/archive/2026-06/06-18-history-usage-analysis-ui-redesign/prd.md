# 历史用量分析 UI 改造

## Goal

将“历史用量分析”看板改造成更接近 Apple 风格的简约、高级、信息密度合理的分析界面：减少重卡片堆叠，用图表、图标、轻量指标和连续布局表达 Token、费用、项目、模型、来源、活跃时段与会话分布。

## What I already know

* 用户目标：历史用量分析 UI 改造，需要 Apple 风格、简约，并尽可能使用图表和图标可视化。
* 当前主入口在 `src/components/stats/StatsPanel.tsx`，弹窗式看板，包含筛选栏、KPI、Token 构成、上下文说明、趋势图、项目排行、模型排行、来源对比、时段活跃、热力图、会话列表。
* 相关可复用图表基础能力：`src/components/stats/EChart.tsx` 已封装 ECharts SVG renderer。
* 现有 `StatsPanel` 影响分析：GitNexus upstream impact 为 LOW，直接上游 0，受影响流程 0。
* 当前样式存在较多 `rounded-xl bg-bg-secondary p-4` 容器，和用户历史反馈“统计/分析类 UI 不要堆太多重边框卡片；优先精致图表和连续布局”一致。
* 项目技术栈：React 19、TypeScript、Tailwind CSS 4、lucide-react、ECharts；不应为 UI 改造新增依赖，除非用户明确批准。

## Assumptions (temporary)

* 本任务优先改造“历史用量分析”即 `StatsPanel.tsx`，不默认改造 `ccusage 用量分析`，除非用户要求统一两者。
* 优先改前端展示与样式，不改变后端统计接口和数据结构。
* 保留现有筛选能力、会话跳转、热力图点击查看会话等交互，不做功能降级。
* Apple 风格理解为：大留白、细分隔线、半透明/毛玻璃感、柔和渐变、少边框、清晰层级、轻量动效、图标辅助。

## Open Questions

* UI 改造范围：只改 `历史用量分析`，还是同时统一 `ccusage 用量分析`？
* 视觉方向：更偏“极简 Apple Health / Activity”，还是“macOS Analytics 毛玻璃桌面面板”，或“Apple Card 财务仪表盘”？

## Requirements (evolving)

* 看板整体视觉更简约、更 Apple 风格，减少重卡片堆叠。
* 尽量用图表、图标、轻量进度/环形/条形视觉表达数据。
* 延续当前筛选与历史会话跳转能力。
* 不引入新依赖作为默认方案。

## Acceptance Criteria (evolving)

* [ ] 历史用量分析弹窗的视觉层级明显变轻，卡片边框和块状背景减少。
* [ ] KPI、Token 构成、趋势、排行、来源、活跃时段、热力图仍可见且数据语义不丢失。
* [ ] 图表/图标可视化占比提升，纯文本堆叠减少。
* [ ] 项目筛选、时间窗口筛选、刷新、热力图选择会话、打开历史会话功能仍可用。
* [ ] `npx tsc --noEmit` 通过。

## Definition of Done

* Tests/checks：至少运行 `npx tsc --noEmit`。
* UI 运行态由用户人工验收；AI 不自动启动桌面应用。
* 不改后端接口，除非后续需求确认需要。
* 若改动多个文件，实施前先给出文件级方案并等待确认。

## Out of Scope (explicit)

* 暂不新增后端统计维度。
* 暂不新增第三方 UI/图表依赖。
* 暂不修改历史日志解析逻辑。
* 暂不默认改造 `ccusage 用量分析`，待用户确认范围。

## Technical Notes

* 关键文件：
  * `src/components/stats/StatsPanel.tsx`：历史用量分析主 UI 与多数局部图表/区块。
  * `src/components/stats/EChart.tsx`：ECharts 组件封装。
  * `src/components/stats/TimelineHeatmap.tsx`：热力图组件。
  * `src/components/stats/StatsHourlyActivityChart.tsx`：小时活跃图。
  * `src/App.css`：已有 `.ui-stats-panel`、`.ui-stats-panel-header`、`.ui-stats-panel-badge` 样式。
* 现有问题倾向：重块状容器较多，部分图表视觉已经可用，但整体缺少统一的 Apple-like 布局语言。
* 可行方向草案：
  * A. Apple Health / Activity 风格：大号关键指标 + 活动环 + 柔和折线，适合用量总览。
  * B. macOS Analytics 毛玻璃风格：半透明面板 + 浮动工具栏 + 连续图表画布，适合桌面应用。
  * C. Apple Card 财务风格：费用/Token 账单化 + 分类图标 + 平滑趋势，适合成本分析。
