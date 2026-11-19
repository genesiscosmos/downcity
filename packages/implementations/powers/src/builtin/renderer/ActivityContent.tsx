/**
 * 官方 Renderer 共用的结构读取与安全正文布局。此模块不推断 Power 业务阶段，
 * 不拼接业务标题；只有 canonical 调用生命周期可作为最低优先级的展示事实。
 */
import type { ReactNode } from "react";
import type { PowerActivityDescription, PowerActivityProps } from "@downcity/city/power/react";

/** 只接收对象记录；未知值不做 JSON 文本化。 */
export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
/** 只接受明确字符串。 */
export function text(value: unknown): string { return typeof value === "string" ? value : ""; }
/** 只在有界前缀上处理摘要。 */
export function preview(value: unknown): string | undefined { return text(value).slice(0, 240).replace(/\s+/g, " ").trim() || undefined; }
/** 有界已知列表读取，不递归遍历工具结果。 */
export function items(value: unknown): Record<string, unknown>[] { return Array.isArray(value) ? value.slice(0, 12).map(record) : []; }
/** 当前语言选择，不请求翻译模型。 */
export function chinese(locale: string): boolean { return /^zh(?:-|$)/i.test(locale); }
/** 输入参数只读取 canonical input.args。 */
export function args_of(props: PowerActivityProps): Record<string, unknown> { return record(record(props.tool.input).args); }
/** 原始 action 只用于精确匹配，不作为用户标题。 */
export function action_of(props: PowerActivityProps): string { return text(record(props.tool.input).action); }
/** 完整业务结果，不读取折叠 model_output。 */
export function data_of(props: PowerActivityProps): Record<string, unknown> { return record(record(props.tool.output).data); }
/** 本次调用的明确错误正文。 */
export function error_of(props: PowerActivityProps): string { return text(props.tool.error) || text(record(props.tool.output).error); }
/** 仅 canonical 调用状态；业务信封由各 Power 自己解释。 */
export function call_tone(props: PowerActivityProps): PowerActivityDescription["tone"] {
  if (props.tool.state === "failed" || record(props.tool.output).success === false) return "failed";
  if (props.tool.state === "waiting-user") return "waiting";
  return props.tool.state === "completed" ? "complete" : "running";
}
/** 安全正文及有界错误只在 detail 挂载后计算。 */
export function ActivityText({ body, error, render_text }: {
  /** 已明确解释的可读正文，不接受任意对象。 */ body?: string;
  /** 用户可处理的失败原因。 */ error?: string;
  /** 宿主的安全 Markdown 阅读端口；不注入执行能力。 */ render_text?: (text: string) => ReactNode;
}) {
  return <div className="space-y-3 p-3 text-xs leading-relaxed">
    {body ? render_text?.(body.slice(0, 48_000)) ?? <p className="whitespace-pre-wrap break-words">{body.slice(0, 48_000)}</p> : null}
    {error ? <p className="text-destructive whitespace-pre-wrap break-words">{error.slice(0, 4_000)}</p> : null}
  </div>;
}
