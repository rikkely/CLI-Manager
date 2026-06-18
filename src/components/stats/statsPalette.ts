// 历史用量分析图表共享语义色板。
// 全部基于主题 token（--accent/--success/--warning）派生，自动跟随各暗色/亮色调色板，
// 避免在多个图表里散落硬编码的高饱和紫/橙/蓝。

const mix = (token: string, percent: number, base = "var(--bg-tertiary)") =>
  `color-mix(in srgb, ${token} ${percent}%, ${base})`;

// Token 构成 / 多系列：以主色为基准，辅以系统语义色 + 透明度梯度区分。
export const SERIES_COLORS = {
  input: "var(--accent)",
  output: "var(--success)",
  cacheCreation: "var(--warning)",
  cacheRead: mix("var(--accent)", 52),
} as const;

// 主趋势线、排行主条等使用的主色；峰值/选中用暖色点缀。
export const ACCENT = "var(--accent)";
export const PEAK = "var(--warning)";

// 费用等辅助量：弱化的暖色，避免与主趋势抢视觉。
export const COST_FILL = "color-mix(in srgb, var(--warning) 32%, transparent)";

// 轻量 tooltip：贴合当前主题表面色，替代原先硬编码的深色玻璃。
export const CHART_TOOLTIP = {
  backgroundColor: "var(--bg-secondary)",
  borderColor: "var(--border)",
  borderWidth: 1,
  padding: [8, 12] as [number, number],
  textStyle: { color: "var(--text-primary)", fontSize: 12 },
  extraCssText: "border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,0.18);",
};
