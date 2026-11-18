"use client";
/** 模型设置页的输入与输出价格对比柱状图。 */

import type { ModelPricingChartProps } from "../../types/model-controls";

import { ControlMessagesProvider, use_control_translation as use_translation } from "../../lib/control-messages";

const width = 680;
const row_height = 42;
const left_padding = 142;
const right_padding = 60;
const bar_height = 8;

/** 展示每百万 token 的输入与输出美元价格。 */
function ModelPricingChartContent({ data, locale }: ModelPricingChartProps) {
  const translate = use_translation("settings");
  const maximum = Math.max(0, ...data.flatMap((item) => [item.input_usd_per_1m, item.output_usd_per_1m]));
  const minimum = Math.min(...data.flatMap((item) => [item.input_usd_per_1m, item.output_usd_per_1m].filter((value) => value > 0)));
  const logarithmic_scale = maximum > 0 && minimum > 0 && maximum / minimum >= 20;
  const plot_width = width - left_padding - right_padding;
  // 低价模型常见小于 0.01 美元，使用有效数字避免被格式化为 0。
  const format_price = (value: number) => value.toLocaleString(locale, { maximumSignificantDigits: 3 });
  const scale_value = (value: number) => logarithmic_scale ? Math.log1p(value) / Math.log1p(maximum) : (maximum ? value / maximum : 0);
  return <div className="overflow-x-auto">
    <svg viewBox={`0 0 ${width} ${Math.max(80, data.length * row_height + 28)}`} className="block h-auto min-w-[34rem] w-full" role="img" aria-label={translate("pricing.chart_label")}>
      <text x={left_padding} y="12" className="fill-muted-foreground/65 text-3xs">{translate("pricing.unit")}{logarithmic_scale ? ` · ${translate("pricing.log_scale")}` : ""}</text>
      {data.map((item, index) => {
        const y = 22 + index * row_height;
        const input_width = scale_value(item.input_usd_per_1m) * plot_width;
        const output_width = scale_value(item.output_usd_per_1m) * plot_width;
        return <g key={item.model_id}>
          <title>{translate("pricing.detail", { name: item.model_name, input: format_price(item.input_usd_per_1m), output: format_price(item.output_usd_per_1m) })}</title>
          <text x={left_padding - 10} y={y + 9} textAnchor="end" className="fill-foreground/80 text-3xs">{item.model_name}</text>
          <rect x={left_padding} y={y} width={input_width} height={bar_height} rx="2" fill="var(--chart-1)" />
          <rect x={left_padding} y={y + 13} width={output_width} height={bar_height} rx="2" fill="var(--chart-2)" />
          <text x={left_padding + input_width + 6} y={y + 8} className="fill-muted-foreground text-3xs">${format_price(item.input_usd_per_1m)}</text>
          <text x={left_padding + output_width + 6} y={y + 21} className="fill-muted-foreground text-3xs">${format_price(item.output_usd_per_1m)}</text>
        </g>;
      })}
      <g transform={`translate(${left_padding}, ${Math.max(30, data.length * row_height + 8)})`}><rect width="8" height="8" rx="2" fill="var(--chart-1)" /><text x="13" y="8" className="fill-muted-foreground text-3xs">{translate("pricing.input")}</text><rect x="55" width="8" height="8" rx="2" fill="var(--chart-2)" /><text x="68" y="8" className="fill-muted-foreground text-3xs">{translate("pricing.output")}</text></g>
    </svg>
  </div>;
}

/** 按宿主 locale 与文案展示价格，无全局语言依赖。 */
export function ModelPricingChart(props: ModelPricingChartProps) {
  return <ControlMessagesProvider translate={props.translate}><ModelPricingChartContent {...props} /></ControlMessagesProvider>;
}
