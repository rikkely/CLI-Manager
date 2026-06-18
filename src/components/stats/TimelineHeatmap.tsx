import { memo, useMemo, useState } from "react";
import type { HistoryStatsHeatmapDay } from "../../lib/types";

interface TimelineHeatmapProps {
  days: HistoryStatsHeatmapDay[];
  selectedDayStart: number | null;
  onSelectDay: (day: HistoryStatsHeatmapDay) => void;
  granularity?: "day" | "hour";
}

// 模块级 formatter 单例：原代码在 N 个 cell 上各 toLocaleDateString，每次都新建 ICU formatter。
const DAY_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
});

function formatDay(dayStartUtc: number): string {
  if (!Number.isFinite(dayStartUtc) || dayStartUtc <= 0) return "-";
  return DAY_FORMATTER.format(new Date(dayStartUtc));
}

function formatHour(hourStartUtc: number): string {
  if (!Number.isFinite(hourStartUtc) || hourStartUtc <= 0) return "-";
  const date = new Date(hourStartUtc);
  return `${String(date.getHours()).padStart(2, "0")}:00`;
}

function formatBucket(dayStartUtc: number, granularity: "day" | "hour"): string {
  return granularity === "hour" ? formatHour(dayStartUtc) : formatDay(dayStartUtc);
}

function cellColor(level: number): string {
  if (level <= 0) return "var(--bg-tertiary)";
  if (level === 1) return "color-mix(in srgb, var(--accent) 24%, var(--bg-tertiary))";
  if (level === 2) return "color-mix(in srgb, var(--accent) 42%, var(--bg-tertiary))";
  if (level === 3) return "color-mix(in srgb, var(--accent) 62%, var(--bg-tertiary))";
  return "color-mix(in srgb, var(--accent) 82%, var(--bg-tertiary))";
}

export const TimelineHeatmap = memo(TimelineHeatmapImpl);

function TimelineHeatmapImpl({
  days,
  selectedDayStart,
  onSelectDay,
  granularity = "day",
}: TimelineHeatmapProps) {
  const [hoverDayStart, setHoverDayStart] = useState<number | null>(null);
  const gridClass =
    granularity === "hour"
      ? "grid grid-cols-12 gap-1 min-w-[214px]"
      : "grid grid-flow-col auto-cols-[14px] grid-rows-7 gap-1 min-w-max";

  const cells = useMemo(() => {
    if (days.length === 0) {
      return [] as Array<
        { type: "pad" } | { type: "day"; day: HistoryStatsHeatmapDay; dayIndex: number }
      >;
    }
    if (granularity === "hour") {
      return days.map((day, dayIndex) => ({ type: "day" as const, day, dayIndex }));
    }
    const first = new Date(days[0].day_start_utc);
    const mondayBasedWeekday = (first.getDay() + 6) % 7;
    const placeholders: Array<{ type: "pad" }> = Array.from({ length: mondayBasedWeekday }, () => ({
      type: "pad",
    }));
    const dayCells = days.map((day, dayIndex) => ({ type: "day" as const, day, dayIndex }));
    return [...placeholders, ...dayCells];
  }, [days, granularity]);

  const activeDay = useMemo(() => {
    const activeKey = hoverDayStart ?? selectedDayStart;
    if (activeKey !== null) {
      const found = days.find((day) => day.day_start_utc === activeKey);
      if (found) return found;
    }
    return days[days.length - 1] ?? null;
  }, [days, hoverDayStart, selectedDayStart]);

  if (days.length === 0) {
    return (
      <div className="py-8 text-center text-[11px] text-text-muted">
        当前过滤条件下暂无热力图数据
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-end gap-2">
        <div className="text-[11px] text-text-secondary">
          {activeDay
            ? `${formatBucket(activeDay.day_start_utc, granularity)} · ${activeDay.sessions} 会话 · ${activeDay.messages} 消息`
            : "-"}
        </div>
      </div>

      <div
        className="overflow-x-auto rounded border border-border bg-bg-primary p-2"
        onMouseLeave={() => setHoverDayStart(null)}
      >
        <div
          className={gridClass}
          role="group"
          aria-label={granularity === "hour" ? "24 小时活跃热力图" : `最近 ${days.length} 天活跃热力图`}
        >
          {cells.map((item, idx) => {
            if (item.type === "pad") {
              return (
                <div
                  key={`pad-${idx}`}
                  className="h-[14px] w-[14px] rounded-[3px]"
                  style={{ backgroundColor: "transparent" }}
                />
              );
            }
            const day = item.day;
            const dayIndex = item.dayIndex;
            const selected = day.day_start_utc === selectedDayStart;
            const hovered = day.day_start_utc === hoverDayStart;
            return (
              <button
                key={day.day_start_utc}
                type="button"
                onClick={() => onSelectDay(day)}
                className="h-[14px] w-[14px] rounded-[3px] border transition-all"
                style={{
                  borderColor: selected ? "var(--accent)" : hovered ? "var(--border)" : "transparent",
                  backgroundColor: cellColor(day.level),
                  transform: hovered || selected ? "scale(1.08)" : "scale(1)",
                  boxShadow: selected
                    ? "0 0 0 1px color-mix(in srgb, var(--accent) 50%, transparent)"
                    : "none",
                }}
                aria-label={`${formatBucket(day.day_start_utc, granularity)}，${day.sessions} 会话，${day.messages} 消息`}
                title={`${formatBucket(day.day_start_utc, granularity)} · ${day.sessions} 会话 · ${day.messages} 消息`}
                data-day-index={dayIndex}
                onMouseEnter={() => setHoverDayStart(day.day_start_utc)}
                onFocus={() => setHoverDayStart(day.day_start_utc)}
                onBlur={() => setHoverDayStart(null)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectDay(day);
                    return;
                  }
                  let delta = 0;
                  if (event.key === "ArrowLeft") delta = granularity === "hour" ? -1 : -7;
                  if (event.key === "ArrowRight") delta = granularity === "hour" ? 1 : 7;
                  if (event.key === "ArrowUp") delta = granularity === "hour" ? -12 : -1;
                  if (event.key === "ArrowDown") delta = granularity === "hour" ? 12 : 1;
                  if (delta === 0) return;
                  event.preventDefault();
                  const nextIndex = Math.max(0, Math.min(days.length - 1, dayIndex + delta));
                  const container = event.currentTarget.parentElement;
                  const nextButton = container?.querySelector<HTMLButtonElement>(
                    `button[data-day-index='${nextIndex}']`
                  );
                  nextButton?.focus();
                }}
              />
            );
          })}
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between">
        <div className="text-[10px] text-text-muted">
          鼠标悬停看详情，点击或回车下钻；方向键可移动焦点
        </div>
        <div className="flex items-center gap-1">
          {[0, 1, 2, 3, 4].map((level) => (
            <span
              key={level}
              className="inline-block h-[10px] w-[10px] rounded-[2px]"
              style={{ backgroundColor: cellColor(level) }}
              title={level === 0 ? "无活动" : `活跃等级 ${level}`}
            />
          ))}
        </div>
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px] text-text-muted">
        <span>{formatBucket(days[0]?.day_start_utc ?? 0, granularity)}</span>
        <span>{formatBucket(days[days.length - 1]?.day_start_utc ?? 0, granularity)}</span>
      </div>
    </div>
  );
}
