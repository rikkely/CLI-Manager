import { memo, useMemo, useState } from "react";
import type { HistoryStatsHourlyActivityItem } from "../../lib/types";

interface StatsHourlyActivityChartProps {
  items: HistoryStatsHourlyActivityItem[];
}

function formatCount(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return new Intl.NumberFormat("zh-CN").format(value);
}

function formatHour(hour: number): string {
  return `${hour.toString().padStart(2, "0")}:00`;
}

export const StatsHourlyActivityChart = memo(StatsHourlyActivityChartImpl);

function StatsHourlyActivityChartImpl({ items }: StatsHourlyActivityChartProps) {
  const [activeHour, setActiveHour] = useState<number | null>(null);
  const normalized = useMemo(() => {
    if (items.length === 24) return items;
    const byHour = new Map<number, HistoryStatsHourlyActivityItem>();
    for (const item of items) byHour.set(item.hour, item);
    const full: HistoryStatsHourlyActivityItem[] = [];
    for (let hour = 0; hour < 24; hour += 1) {
      full.push(
        byHour.get(hour) ?? {
          hour,
          hour_start_utc: 0,
          sessions: 0,
          messages: 0,
          level: 0,
          input_tokens: 0,
          output_tokens: 0,
          cache_read_tokens: 0,
          cache_creation_tokens: 0,
          total_cost_usd: 0,
          unpriced_tokens: 0,
          session_refs: [],
        }
      );
    }
    return full;
  }, [items]);

  const chart = useMemo(() => {
    const width = 620;
    const height = 220;
    const paddingLeft = 22;
    const paddingTop = 14;
    const paddingBottom = 26;
    const innerHeight = height - paddingTop - paddingBottom;
    const maxValue = Math.max(
      1,
      ...normalized.flatMap((item) => [item.sessions, item.messages])
    );
    const groupGap = 2;
    const groupWidth = 22;
    const barWidth = Math.floor((groupWidth - groupGap) / 2);
    const points = normalized.map((item, index) => {
      const x = paddingLeft + index * groupWidth;
      const sessionsHeight = (item.sessions / maxValue) * innerHeight;
      const messagesHeight = (item.messages / maxValue) * innerHeight;
      return {
        item,
        index,
        x,
        sessionsY: paddingTop + innerHeight - sessionsHeight,
        messagesY: paddingTop + innerHeight - messagesHeight,
        sessionsHeight,
        messagesHeight,
      };
    });
    return {
      width,
      height,
      paddingLeft,
      paddingTop,
      paddingBottom,
      innerHeight,
      maxValue,
      groupWidth,
      barWidth,
      points,
    };
  }, [normalized]);

  const active = useMemo(() => {
    if (activeHour !== null) {
      const found = normalized.find((item) => item.hour === activeHour);
      if (found) return found;
    }
    return normalized.find((item) => item.sessions > 0 || item.messages > 0) ?? normalized[0] ?? null;
  }, [activeHour, normalized]);

  return (
    <div className="rounded-xl border border-border/60 bg-bg-secondary p-3">
      <div className="mb-2 flex items-center gap-2">
        <div className="text-xs font-semibold text-text-primary">活跃时段分布</div>
        <div className="ml-auto text-[11px] text-text-secondary">
          {active
            ? `${formatHour(active.hour)} · ${formatCount(active.sessions)} 会话 · ${formatCount(active.messages)} 消息`
            : "暂无时段数据"}
        </div>
      </div>

      {normalized.length === 0 && (
        <div className="py-8 text-center text-[11px] text-text-muted">
          当前过滤条件下没有时段数据
        </div>
      )}

      {normalized.length > 0 && (
        <>
          <div
            className="overflow-x-auto rounded border border-border bg-bg-primary"
            onMouseLeave={() => setActiveHour(null)}
          >
            <svg
              width={chart.width}
              height={chart.height}
              viewBox={`0 0 ${chart.width} ${chart.height}`}
              role="img"
              aria-label="24 小时会话与消息分组柱状图"
              className="block"
            >
              {[0, 1, 2, 3].map((step) => {
                const y = chart.paddingTop + (chart.innerHeight * step) / 3;
                const value = Math.round(((3 - step) * chart.maxValue) / 3);
                return (
                  <g key={step}>
                    <line
                      x1={chart.paddingLeft}
                      x2={chart.width - 8}
                      y1={y}
                      y2={y}
                      stroke="var(--border)"
                      strokeOpacity="0.45"
                      strokeWidth="1"
                    />
                    <text x={4} y={y - 2} fill="var(--text-muted)" fontSize="9">
                      {value}
                    </text>
                  </g>
                );
              })}

              {chart.points.map((point) => (
                <g key={point.item.hour}>
                  <rect
                    x={point.x}
                    y={point.sessionsY}
                    width={chart.barWidth}
                    height={Math.max(1, point.sessionsHeight)}
                    rx={2}
                    fill="var(--accent)"
                    fillOpacity={activeHour === point.item.hour ? 1 : 0.86}
                  />
                  <rect
                    x={point.x + chart.barWidth + 2}
                    y={point.messagesY}
                    width={chart.barWidth}
                    height={Math.max(1, point.messagesHeight)}
                    rx={2}
                    fill="var(--success)"
                    fillOpacity={activeHour === point.item.hour ? 1 : 0.86}
                  />
                  {point.item.hour % 3 === 0 && (
                    <text
                      x={point.x + chart.groupWidth / 2}
                      y={chart.height - 8}
                      textAnchor="middle"
                      fill="var(--text-muted)"
                      fontSize="9"
                    >
                      {point.item.hour}
                    </text>
                  )}
                  <rect
                    x={point.x}
                    y={chart.paddingTop}
                    width={chart.groupWidth}
                    height={chart.innerHeight}
                    fill="transparent"
                    tabIndex={0}
                    onMouseEnter={() => setActiveHour(point.item.hour)}
                    onFocus={() => setActiveHour(point.item.hour)}
                    onBlur={() => setActiveHour(null)}
                    aria-label={`${formatHour(point.item.hour)}，${point.item.sessions} 会话，${point.item.messages} 消息`}
                    data-hour-index={point.index}
                    onKeyDown={(event) => {
                      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                      event.preventDefault();
                      const nextIndex =
                        event.key === "ArrowRight"
                          ? Math.min(chart.points.length - 1, point.index + 1)
                          : Math.max(0, point.index - 1);
                      const root = event.currentTarget.ownerSVGElement;
                      const next = root?.querySelector<SVGRectElement>(
                        `rect[data-hour-index='${nextIndex}']`
                      );
                      next?.focus();
                    }}
                  />
                </g>
              ))}
            </svg>
          </div>

          <div className="mt-1 flex items-center gap-3 text-[10px] text-text-muted">
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: "var(--accent)" }} />
              会话
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: "var(--success)" }} />
              消息
            </span>
          </div>
        </>
      )}
    </div>
  );
}
