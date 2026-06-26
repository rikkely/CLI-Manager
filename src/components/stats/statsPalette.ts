// 用量分析图表共享色板。
// 实时小图继续使用主题语义色；历史/ccusage 分析图使用固定可区分图表色，
// 避免某些主题下 --accent / --success 过近导致多条线和扇区看起来同色。

const mix = (token: string, percent: number, base = "var(--bg-tertiary)") =>
  `color-mix(in srgb, ${token} ${percent}%, ${base})`;

// Token 构成 / 多系列：以主色为基准，辅以系统语义色 + 透明度梯度区分。
export const SERIES_COLORS = {
  input: "var(--accent)",
  output: "var(--success)",
  cacheCreation: "var(--warning)",
  cacheRead: mix("var(--accent)", 52),
} as const;

export const USAGE_SERIES_COLORS = {
  input: "#34d399",
  output: "#fb7185",
  cacheCreation: "#facc15",
  cacheRead: "#a78bfa",
} as const;

export const USAGE_TREND_COLORS = {
  total: "#60a5fa",
  ...USAGE_SERIES_COLORS,
} as const;

export const HISTORY_SERIES_COLORS = USAGE_SERIES_COLORS;
export const HISTORY_TREND_COLORS = USAGE_TREND_COLORS;

// 主趋势线、排行主条等使用的主色；峰值/选中用暖色点缀。
export const ACCENT = "var(--accent)";
export const PEAK = "var(--warning)";

// 费用等辅助量：弱化的暖色，避免与主趋势抢视觉。
export const COST_FILL = "color-mix(in srgb, var(--warning) 32%, transparent)";

export const RECHARTS_AXIS_CURSOR = {
  stroke: "color-mix(in srgb, var(--accent) 36%, transparent)",
  strokeWidth: 1,
} as const;

export const RECHARTS_BAR_CURSOR = {
  fill: "color-mix(in srgb, var(--accent) 10%, transparent)",
} as const;

export const ECHARTS_AXIS_SHADOW = "color-mix(in srgb, var(--accent) 10%, transparent)";
export const ECHARTS_AXIS_LINE = "color-mix(in srgb, var(--accent) 36%, transparent)";

export const RECHARTS_TOOLTIP_WRAPPER_STYLE = {
  outline: "none",
} as const;

export const RECHARTS_TOOLTIP_LABEL_STYLE = {
  color: "var(--text-primary)",
  fontWeight: 600,
} as const;

export const RECHARTS_TOOLTIP_ITEM_STYLE = {
  color: "var(--text-secondary)",
} as const;

// 轻量 tooltip：贴合当前主题表面色，替代原先硬编码的深色玻璃。
export const CHART_TOOLTIP = {
  backgroundColor: "var(--bg-secondary)",
  borderColor: "var(--border)",
  borderWidth: 1,
  padding: [8, 12] as [number, number],
  textStyle: { color: "var(--text-primary)", fontSize: 12 },
  extraCssText: "border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,0.18);color:var(--text-primary);",
};
