/** Inbox 来源身份：真实 Agent 头像交由宿主解析，纯 Power 更新保留中性业务图标。 */
import type { InboxEntry } from "../types/Inbox.js";
import type { NotificationRendererOptions } from "../types/NotificationRenderer.js";
import { InboxIcon } from "./InboxIcon.js";

/** 列表与详情使用同一身份端口，不根据状态替换或叠加头像。 */
export function InboxAvatar({ entry, size, options }: {
  /** 原始来源投影；仅真实 Agent 来源携带 agent_id。 */ entry: InboxEntry;
  /** 展示位置，宿主据此选择头像尺寸。 */ size: "list" | "detail";
  /** 受信宿主提供的头像渲染能力。 */ options: NotificationRendererOptions;
}) {
  return <span className="inbox-avatar" data-size={size} aria-hidden="true">
    {(entry.agent_id && options.render_agent_avatar?.(entry.agent_id, size)) || <InboxIcon kind={entry.agent_id ? "agent" : "update"} />}
  </span>;
}
