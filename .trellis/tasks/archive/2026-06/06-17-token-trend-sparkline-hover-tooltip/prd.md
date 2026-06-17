# Token trend sparkline hover tooltip

## Goal

给"实时统计"里的"Token 趋势"折线图增加悬浮交互：鼠标移到折线上时，显示对应数据点的用量明细（输入 / 输出 / 缓存读 / 缓存写 / 总计）与序号（第 N 条）。

## What I already know

* 实时统计"Token 趋势"卡片为 `TrendCard`，位于 `src/components/stats/termStatsCards.tsx:149`。
* 折线图组件 `Sparkline` 位于 `src/components/stats/termStatsUi.tsx:328`，当前为纯静态 SVG（`viewBox="0 0 100 100"` + `preserveAspectRatio="none"` 拉伸），只有线 + 渐变区域 + 末尾脉冲点，**无任何 hover / tooltip**。
* 趋势数据每个点含完整明细 `HistoryTokenTrendPoint`（`input_tokens` / `output_tokens` / `cache_read_tokens` / `cache_creation_tokens` / `total_tokens`），定义在 `src/lib/types.ts:140`。
* 但 `TrendCard` 当前把每点压成 `number[]`（`termStatsCards.tsx:156-169`）后传给 `Sparkline`，明细在传参时被丢弃。
* `Sparkline` 仅 `TrendCard`（`termStatsCards.tsx:189`）一处引用，可安全扩展契约。
* `TERM` 终端配色在 `termStatsUi.tsx` 顶部常量中。
* 用户已确认 tooltip 内容选择「完整明细 + 序号」。

## Assumptions (temporary)

* 命中检测用外层 div 的像素坐标计算最近点索引（点数 ≤ 40，离散定位即可），不在拉伸的 SVG 坐标系里做。
* tooltip 走 `TERM` 终端风格（暗底、紧凑、等宽），不引入通用 UI 控件样式。
* 仅前端交互增强，不改后端、不改 `token_trend` 数据结构、不新增依赖。

## Open Questions

* 无（内容范围已确认为「完整明细 + 序号」）。

## Requirements (evolving)

* `Sparkline` 数据契约扩展为可携带每点明细（兼容方式，不破坏纯数值调用）。
* 鼠标在折线区移动时定位最近数据点，叠加高亮圆点 + 竖直辅助线 + tooltip。
* tooltip 显示：序号（第 N 条 / 共 M 条）、输入、输出、缓存读、缓存写、总计。
* tooltip 做边界处理，靠左/靠右的点不溢出卡片。
* 鼠标移出折线区时 tooltip 消失。

## Acceptance Criteria (evolving)

* [ ] 悬浮折线任意位置，显示对应最近点的 tooltip，含 5 项 token + 序号。
* [ ] tooltip 数值与该点实际数据一致。
* [ ] 边缘点的 tooltip 不溢出卡片容器。
* [ ] 鼠标移出后 tooltip 消失。
* [ ] 旧的纯数值调用方式仍能正常渲染（向后兼容）。
* [ ] `npx tsc --noEmit` 通过。

## Definition of Done (team quality bar)

* UI-only 交互增强，无现有测试可不新增测试。
* `npx tsc --noEmit` 通过，或如失败如实报告。
* 不修改无关功能、不新增依赖。
* 运行态视觉/交互效果只能人工验收，明确说明。

## Out of Scope (explicit)

* 不改后端历史解析与 `token_trend` 数据结构。
* 不改历史看板的 `StatsTokenTrendChart`。
* 不调整 `Sparkline` 以外的其他实时统计卡片。
* 不新增依赖或主题配置项。

## Technical Notes

* Inspected `src/components/stats/termStatsUi.tsx`（`Sparkline` 实现、`TERM` 配色）。
* Inspected `src/components/stats/termStatsCards.tsx`（`TrendCard` 数据组装与调用）。
* Inspected `src/lib/types.ts`（`HistoryTokenTrendPoint` 明细字段）。
* 实现前对 `Sparkline` / `TrendCard` 运行 `gitnexus_impact`（upstream）确认 blast radius。
