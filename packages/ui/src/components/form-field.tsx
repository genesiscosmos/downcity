/**
 * Downcity FormField 无表单库字段布局。
 *
 * 关键说明（中文）
 * - 仅组织标签、说明、错误与控件。
 * - 状态与校验由宿主或任意表单库拥有。
 */

import { cn } from "../lib/utils";
import type { DowncityFormFieldProps } from "../types/components";

function FormField({ label, description, error, required = false, children, horizontal = false, className }: DowncityFormFieldProps) {
  if (horizontal) {
    return <div className={cn("flex items-center justify-between gap-4 rounded-lg px-3 py-2 transition-colors hover:bg-interaction-hover", className)}><div className="min-w-0"><div className="text-sm text-foreground">{label}{required ? <span className="ml-0.5 text-destructive">*</span> : null}</div>{description ? <div className="text-xs text-muted-foreground">{description}</div> : null}</div><div className="shrink-0">{children}</div></div>;
  }
  return <div className={cn("flex flex-col gap-2", className)}><div className="flex flex-col gap-0.5 px-1"><div className="text-sm text-foreground">{label}{required ? <span className="ml-0.5 text-destructive">*</span> : null}</div>{description ? <div className="text-xs text-muted-foreground">{description}</div> : null}</div>{children}{error ? <div className="px-1 text-xs text-destructive">{error}</div> : null}</div>;
}

export { FormField };
