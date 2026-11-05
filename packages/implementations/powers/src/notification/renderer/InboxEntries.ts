/** Inbox列表、详情与时间的纯展示投影；稳定来源键避免刷新时重建表单。 */
import type { InboxEntry, InboxView } from "../types/Inbox.js";
import type { NotificationListResult, NotificationInteractionItem } from "../types/NotificationRenderer.js";

/** 同一交互在消息与Part事件中重复出现时只保留一项。 */
export function interaction_key(item: NotificationInteractionItem): string {
  const ref = item.interaction.reference;
  return JSON.stringify([item.agent_id, ref.session_category, ref.session_id, ref.turn_id, ref.interaction_id]);
}

/** 私密问题保持原分类，只将展示语义标记为私密输入。 */
export function has_private_questions(item: NotificationInteractionItem): boolean {
  const payload = item.interaction.interaction.request.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  return Array.isArray(payload.questions) && payload.questions.some((question) => question
    && typeof question === "object" && !Array.isArray(question) && question.type === "secret");
}

/** 收敛重复项目，完成时间和请求产生时间均来自原始数据。 */
export function inbox_entries(data: NotificationListResult | undefined, view: InboxView): InboxEntry[] {
  if (!data) return [];
  const agent_names = new Map(Object.entries(data.agent_names));
  const entries: InboxEntry[] = view === "pending" ? data.interactions
    .filter((item) => item.interaction.interaction.status === "pending")
    .map((item) => {
      const request = item.interaction.interaction.request;
      const kind = has_private_questions(item) ? "secret" : request.type === "approval" ? "approval" : "question";
      const payload = request.payload;
      const first = payload && typeof payload === "object" && !Array.isArray(payload) && Array.isArray(payload.questions) ? payload.questions[0] : undefined;
      const question = first && typeof first === "object" && !Array.isArray(first) && typeof first.question === "string" ? first.question : undefined;
      return { key: interaction_key(item), view, title: request.title || question || kind_label(kind),
        source: agent_names.get(item.agent_id)?.trim() || item.agent_name?.trim() || "未命名 Agent", created_at: request.created_at,
        kind, unread: true, pending: item };
    }) : data.items.filter((item) => item.scope === "inbox").map((item) => ({ key: item.notification_id, view,
      title: item.title, source: item.agent_id ? agent_names.get(item.agent_id)?.trim() || "Agent 不可用" : source_label(item.power_id),
      created_at: item.created_at, kind: "update", unread: !item.read, update: item }));
  return [...new Map(entries.map((entry) => [entry.key, entry])).values()]
    .sort((left, right) => view === "pending" ? left.created_at - right.created_at : right.created_at - left.created_at);
}

/** 用户可见的类别，不暴露Session类别与内部标识。 */
export function kind_label(kind: InboxEntry["kind"]): string {
  return { question: "需要回答", approval: "需要授权", secret: "私密输入", update: "工作更新" }[kind];
}

/** 标准业务来源名称。 */
function source_label(power_id: string): string {
  return ({ task: "任务", memory: "记忆", notification: "Agent" } as Record<string, string>)[power_id] ?? power_id;
}

/** 列表相对时间；精确时间由详情和title属性提供。 */
export function relative_time(timestamp: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} 小时前`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(timestamp);
}

/** 详情完整本地时间，不截断日期或时区信息。 */
export function full_time(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(timestamp);
}
