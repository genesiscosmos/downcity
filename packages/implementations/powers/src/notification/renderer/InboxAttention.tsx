/** Inbox 状态的展示端口：可读状态来自原业务，颜色由宿主共用的 Rail 规则提供。 */
import type { InboxEntry } from "../types/Inbox.js";
import type { NotificationRendererOptions } from "../types/NotificationRenderer.js";
import { kind_label } from "./InboxEntries.js";

/** 中断请求使用中性文字；已读通知只移除圆点，保留原业务结果。 */
export function InboxAttention({ entry, options, presentation }: {
  /** 原始事项投影，不修改其已读或业务状态。 */ entry: InboxEntry;
  /** 宿主可选提供共享注意力展示。 */ options: NotificationRendererOptions;
  /** 状态文字或仍需注意的圆点。 */ presentation: "dot" | "status";
}) {
  const interrupted = !!entry.pending && !entry.pending.interaction.can_respond;
  const label = interrupted ? "已中断" : entry.update?.outcome === "failure" ? "执行失败"
    : entry.update?.outcome === "success" ? "已完成" : kind_label(entry.kind);
  if (presentation === "dot" && (!entry.unread || interrupted)) return null;
  if (interrupted) return <span>{label}</span>;
  return options.render_attention?.({ kind: entry.pending ? "request" : "update",
    outcome: entry.update?.outcome ?? "info", presentation, label })
    ?? (presentation === "dot" ? <span className="inbox-attention-dot inbox-attention-neutral" role="img" aria-label={label} title={label} /> : <span>{label}</span>);
}
