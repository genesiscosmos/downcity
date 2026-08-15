/** 与 Duobox 一致的账户 Credits 趋势折线图。 */

import { useId, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { format_credits_as_usd } from "@/lib/usage/usage_format";
import type { UsagePeriod, UsageTrendPoint } from "@/types/DesktopUsage";

const width = 680;
const height = 190;
const padding = { top: 18, right: 12, bottom: 28, left: 58 };

/** Credits 趋势图属性。 */
interface UsageLineChartProps {
  /** 按当前周期聚合的趋势数据。 */
  series: UsageTrendPoint[];
  /** 当前聚合周期。 */
  period: UsagePeriod;
  /** 一美元对应的 Credits 数量。 */
  credits_per_usd?: number;
}

/** SVG 绘图区中的一个坐标点。 */
interface UsageChartPoint {
  /** 点在 SVG 坐标系中的横坐标。 */
  x: number;
  /** 点在 SVG 坐标系中的纵坐标。 */
  y: number;
}

function date_value(date: string): Date {
  return new Date(`${date}T12:00:00Z`);
}

function line_path(points: UsageChartPoint[]): string {
  return points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`).join(" ");
}

/** 展示可通过指针或键盘检查数据点的 Credits 趋势。 */
export function UsageLineChart({ series, period, credits_per_usd }: UsageLineChartProps) {
  const [active_index, set_active_index] = useState<number | null>(null);
  const gradient_id = `usage-area-${useId().replace(/:/gu, "")}`;
  const date_formatter = useMemo(() => new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }), []);
  const month_formatter = useMemo(() => new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short" }), []);
  const format_amount = (credits: number) => format_credits_as_usd(credits, credits_per_usd);
  const format_range = (point: UsageTrendPoint) => {
    if (period === "day") return date_formatter.format(date_value(point.start_date));
    if (period === "month") return month_formatter.format(date_value(point.start_date));
    return `${date_formatter.format(date_value(point.start_date))} - ${date_formatter.format(date_value(point.end_date))}`;
  };
  const period_label = period === "day" ? "日" : period === "week" ? "周" : "月";
  const maximum = Math.max(0, ...series.map((point) => point.credits_used));
  const plot_width = width - padding.left - padding.right;
  const plot_height = height - padding.top - padding.bottom;
  const points = series.map((point, index) => ({
    x: padding.left + (series.length <= 1 ? 0 : index / (series.length - 1) * plot_width),
    y: padding.top + (maximum <= 0 ? plot_height : (1 - point.credits_used / maximum) * plot_height),
  }));
  const path = line_path(points);
  const area_path = points.length ? `${path} L${points.at(-1)?.x},${padding.top + plot_height} L${points[0].x},${padding.top + plot_height} Z` : "";
  const active_point = active_index === null ? null : series[active_index] ?? null;
  const active_position = active_index === null || series.length <= 1 ? 0 : active_index / (series.length - 1) * 100;

  return <div className="relative" onPointerLeave={() => set_active_index(null)}>
    {active_point ? <div className={cn(
      "pointer-events-none absolute top-1 z-10 min-w-28 rounded-lg border border-border-subtle bg-background/95 px-2.5 py-2 shadow-lg backdrop-blur-sm",
      active_index === 0 ? "translate-x-0" : active_index === series.length - 1 ? "-translate-x-full" : "-translate-x-1/2",
    )} style={{ left: `${active_position}%` }}>
      <p className="text-[10px] text-muted-foreground">{format_range(active_point)}</p>
      <p className="mt-1 text-sm font-semibold tabular-nums text-foreground">{format_amount(active_point.credits_used)}</p>
    </div> : null}
    <svg viewBox={`0 0 ${width} ${height}`} className="block h-auto w-full overflow-visible" role="img" aria-label={`按${period_label}统计的 Credits 趋势`}>
      <defs><linearGradient id={gradient_id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-2)" stopOpacity="0.24" /><stop offset="100%" stopColor="var(--chart-2)" stopOpacity="0" /></linearGradient></defs>
      {[0, 0.5, 1].map((ratio) => {
        const y = padding.top + ratio * plot_height;
        return <line key={ratio} x1={padding.left} x2={width - padding.right} y1={y} y2={y} stroke="var(--divider)" strokeWidth="1" />;
      })}
      <text x={padding.left - 8} y={padding.top + 3} textAnchor="end" className="fill-muted-foreground/65 text-[9px]">{format_amount(maximum)}</text>
      <text x={padding.left - 8} y={padding.top + plot_height + 3} textAnchor="end" className="fill-muted-foreground/65 text-[9px]">$0.00</text>
      {area_path ? <path d={area_path} fill={`url(#${gradient_id})`} /> : null}
      {path ? <path d={path} fill="none" stroke="var(--chart-2)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" /> : null}
      {points.map((point, index) => <g key={series[index].key}>
        {active_index === index ? <circle cx={point.x} cy={point.y} r="4" fill="var(--background)" stroke="var(--chart-2)" strokeWidth="2" vectorEffect="non-scaling-stroke" /> : null}
        <rect x={point.x - plot_width / series.length / 2} y={padding.top} width={plot_width / series.length} height={plot_height} fill="transparent" tabIndex={0} aria-label={`${format_range(series[index])}, ${format_amount(series[index].credits_used)}`} onPointerEnter={() => set_active_index(index)} onPointerDown={() => set_active_index(index)} onFocus={() => set_active_index(index)} onBlur={() => set_active_index(null)} />
      </g>)}
      {[0, Math.floor((series.length - 1) / 2), series.length - 1].filter((index, position, values) => index >= 0 && values.indexOf(index) === position).map((index) => <text key={series[index]?.key} x={points[index]?.x} y={height - 7} textAnchor={index === 0 ? "start" : index === series.length - 1 ? "end" : "middle"} className="fill-muted-foreground/65 text-[9px]">{series[index] ? format_range(series[index]) : ""}</text>)}
    </svg>
  </div>;
}
