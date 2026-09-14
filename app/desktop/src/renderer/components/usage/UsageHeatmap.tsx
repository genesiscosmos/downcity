/** 与 Duobox 一致的账户活动热力图。 */

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { format_credits_as_usd } from "@/lib/usage/usage_format";
import type { UsageHeatmap as UsageHeatmapData } from "@/types/DesktopUsage";
import { format_number, get_intl_locale } from "@/locales/format";
import { use_desktop_language, use_translation } from "@/locales/i18n";

const level_classes = [
  "bg-surface-subtle",
  "bg-chart-2/20",
  "bg-chart-2/40",
  "bg-chart-2/65",
  "bg-chart-2",
] as const;

/** 活动热力图属性。 */
interface UsageHeatmapProps {
  /** 按自然周排列的热力图数据。 */
  heatmap: UsageHeatmapData;
  /** 热力图范围内消费的 Credits。 */
  credits_used: number;
  /** 一美元对应的 Credits 数量。 */
  credits_per_usd?: number;
}

function date_value(date: string): Date {
  return new Date(`${date}T12:00:00Z`);
}

/** 展示最近一年的 Credits 活动强度。 */
export function UsageHeatmap({ heatmap, credits_used, credits_per_usd }: UsageHeatmapProps) {
  const language = use_desktop_language();
  const translate = use_translation("settings");
  const locale = get_intl_locale(language);
  const date_formatter = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }), [locale]);
  const month_formatter = useMemo(() => new Intl.DateTimeFormat(locale, { month: "short" }), [locale]);
  const format_amount = (credits: number) => format_credits_as_usd(credits, credits_per_usd);
  const format_activity = (day: UsageHeatmapData["weeks"][number]["days"][number]) => heatmap.metric === "credits"
    ? translate("usage.credits_activity", { amount: format_amount(day.credits_used) })
    : translate("usage.ai_activity", { count: day.execution_count, tokens: format_number(day.total_tokens, language) });
  const activity_label = heatmap.metric === "credits"
    ? translate("usage.year_credits", { amount: format_amount(credits_used) })
    : translate("usage.year_calls", { count: heatmap.weeks.flatMap((week) => week.days).reduce((total, day) => total + (day.in_range ? day.execution_count : 0), 0) });

  return <div role="img" aria-label={activity_label}>
    <div className="min-w-0 overflow-x-clip pb-1">
      <div className="w-full min-w-0">
        <div className="mb-2 grid h-4 min-w-0 gap-[2px] text-[0.625rem] text-muted-foreground sm:gap-1" style={{ gridTemplateColumns: `repeat(${heatmap.weeks.length}, minmax(0, 1fr))` }}>
          {heatmap.months.map((month) => <span key={month.key} className="whitespace-nowrap" style={{ gridColumnStart: month.column + 1 }}>{month_formatter.format(date_value(month.date))}</span>)}
        </div>
        <div className="grid min-w-0 gap-[2px] sm:gap-1" style={{ gridTemplateColumns: `repeat(${heatmap.weeks.length}, minmax(0, 1fr))` }}>
          {heatmap.weeks.map((week) => <div key={week.key} className="grid min-w-0 grid-rows-7 gap-[2px] sm:gap-1">
            {week.days.map((day) => {
              const label = `${date_formatter.format(date_value(day.date))}: ${format_activity(day)}`;
              return <span key={day.date} title={day.in_range ? label : undefined} aria-hidden="true" className={cn(
                "aspect-square min-w-0 rounded-[2px] transition-[transform,filter] duration-150 hover:scale-125 hover:brightness-110 motion-reduce:transition-none sm:rounded-[3px]",
                day.in_range ? level_classes[day.level] : "bg-transparent",
              )} />;
            })}
          </div>)}
        </div>
      </div>
    </div>
    <div className="mt-3 flex items-center justify-end gap-1.5 text-[0.625rem] text-muted-foreground">
      <span>{translate("usage.less")}</span>
      {level_classes.map((class_name, index) => <span key={index} aria-hidden="true" className={cn("size-2.5 rounded-[3px]", class_name)} />)}
      <span>{translate("usage.more")}</span>
    </div>
  </div>;
}
