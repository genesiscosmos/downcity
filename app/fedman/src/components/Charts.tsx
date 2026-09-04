/** Fedman 零运行时依赖 SVG 图表组件。 */

import { format_compact_number, format_number, format_percent } from "../lib/format.js";
import { MessageState } from "./Common.js";
import type { BarChartProps, ChartLegendProps, FunnelChartProps, HorizontalBarsProps, LineChartProps, StackedChartProps } from "../types/ui.js";

/** 从任意对象读取字段。 */
function read_field(item: object, key: string): unknown {
  return (item as Record<string, unknown>)[key];
}

/** 把字段读取为有限数值，无效值回退为零。 */
function read_number(item: object, key: string): number {
  const value = Number(read_field(item, key));
  return Number.isFinite(value) ? value : 0;
}

/** 渲染多序列折线图。 */
export function LineChart({ data, series, percent = false }: LineChartProps) {
  if (!data.length) return <MessageState compact>暂无趋势数据</MessageState>;
  const width = 760;
  const height = 280;
  const left = 46;
  const right = 16;
  const top = 20;
  const bottom = 34;
  const values = data.flatMap((item) => series.map((line) => read_number(item, line.key)));
  const max_value = Math.max(1, ...values);
  const x = (index: number) => left + index * (width - left - right) / Math.max(1, data.length - 1);
  const y = (value: number) => top + (height - top - bottom) * (1 - Math.max(0, value) / max_value);
  const label_interval = Math.max(1, Math.ceil(data.length / 6));
  return <><ChartLegend series={series} /><svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img">
    <g className="chart-grid">
      {Array.from({ length: 5 }, (_, index) => {
        const ratio = index / 4;
        const grid_y = top + ratio * (height - top - bottom);
        const value = max_value * (1 - ratio);
        return <g key={index}><line x1={left} x2={width - right} y1={grid_y} y2={grid_y} /><text x={left - 8} y={grid_y + 4}>{percent ? `${Math.round(value * 100)}%` : format_compact_number(value)}</text></g>;
      })}
      {data.map((item, index) => (index % label_interval === 0 || index === data.length - 1) && <text key={index} x={x(index)} y={height - 8} textAnchor="middle">{String(read_field(item, "date") ?? read_field(item, "label") ?? "").slice(5)}</text>)}
    </g>
    {series.map((line) => <polyline key={line.key} points={data.map((item, index) => `${x(index)},${y(read_number(item, line.key))}`).join(" ")} fill="none" stroke={line.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />)}
  </svg></>;
}

/** 渲染单序列柱状图。 */
export function BarChart({ data, value_key, label_key, color, label_format = (value) => String(value).slice(5) }: BarChartProps) {
  if (!data.length) return <MessageState compact>暂无分布数据</MessageState>;
  const width = 760;
  const height = 260;
  const left = 42;
  const right = 12;
  const top = 16;
  const bottom = 34;
  const max_value = Math.max(1, ...data.map((item) => read_number(item, value_key)));
  const slot = (width - left - right) / data.length;
  const bar_width = Math.max(2, slot * 0.62);
  const label_interval = Math.max(1, Math.ceil(data.length / 7));
  return <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img">{data.map((item, index) => {
    const value = read_number(item, value_key);
    const bar_height = (height - top - bottom) * value / max_value;
    const bar_x = left + index * slot + (slot - bar_width) / 2;
    const label = label_format(read_field(item, label_key));
    return <g key={`${label}-${index}`}><rect x={bar_x} y={height - bottom - bar_height} width={bar_width} height={bar_height} rx="3" fill={color}><title>{`${label}: ${format_number(value)}`}</title></rect>{index % label_interval === 0 && <text x={bar_x + bar_width / 2} y={height - 10} textAnchor="middle">{label}</text>}</g>;
  })}</svg>;
}

/** 渲染多序列堆叠柱状图。 */
export function StackedChart({ data, series }: StackedChartProps) {
  if (!data.length) return <MessageState compact>暂无趋势数据</MessageState>;
  const width = 760;
  const height = 270;
  const left = 42;
  const right = 12;
  const top = 16;
  const bottom = 34;
  const totals = data.map((item) => series.reduce((sum, line) => sum + read_number(item, line.key), 0));
  const max_value = Math.max(1, ...totals);
  const slot = (width - left - right) / data.length;
  const bar_width = Math.max(2, slot * 0.68);
  return <><ChartLegend series={series} /><svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img">{data.map((item, index) => {
    let cursor = height - bottom;
    return <g key={String(read_field(item, "date") ?? index)}>{series.map((line) => {
      const value = read_number(item, line.key);
      const bar_height = (height - top - bottom) * value / max_value;
      cursor -= bar_height;
      return <rect key={line.key} x={left + index * slot + (slot - bar_width) / 2} y={cursor} width={bar_width} height={bar_height} fill={line.color}><title>{`${String(read_field(item, "date") ?? "")} · ${line.label}: ${format_number(value)}`}</title></rect>;
    })}</g>;
  })}</svg></>;
}

/** 渲染维度排行横向条。 */
export function HorizontalBars({ data, value_key, label_key, color }: HorizontalBarsProps) {
  if (!data.length) return <MessageState compact>暂无分布数据</MessageState>;
  const max_value = Math.max(1, ...data.map((item) => read_number(item, value_key)));
  return <div className="horizontal-bars">{data.map((item) => {
    const label = String(read_field(item, label_key) ?? "");
    const value = read_number(item, value_key);
    return <div className="horizontal-row" key={label}><div><strong>{label}</strong><span>{format_number(value)}</span></div><div className="bar-track"><i style={{ width: `${value / max_value * 100}%`, background: color }} /></div></div>;
  })}</div>;
}

/** 渲染平均留存漏斗。 */
export function FunnelChart({ items }: FunnelChartProps) {
  const max_value = Math.max(0.01, ...items.map((item) => item.value ?? 0));
  return <div className="funnel">{items.map((item, index) => <div key={item.label} style={{ width: `${Math.max(28, (item.value ?? 0) / max_value * 100)}%`, opacity: 1 - index * 0.1 }}><span>{item.label}</span><strong>{format_percent(item.value)}</strong></div>)}</div>;
}

/** 渲染图表图例。 */
function ChartLegend({ series }: ChartLegendProps) {
  return <div className="chart-legend">{series.map((line) => <span key={line.key}><i style={{ background: line.color }} />{line.label}</span>)}</div>;
}
