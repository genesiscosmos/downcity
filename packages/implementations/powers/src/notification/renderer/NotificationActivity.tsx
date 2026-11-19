/** Notification 的业务动作展示；宿主页面同步本身不产生新的聊天输入。 */
import type { PowerActivityProps, PowerActivityRenderer } from "@downcity/city/power/react";
import { ActivityText, action_of, call_tone, chinese, error_of } from "@/builtin/renderer/ActivityContent.js";

/** 精确匹配宿主 Notification action，不从任意字段猜状态。 */
const completed: Readonly<Record<string, readonly [string, string]>> = {
  list: ["已查看收件箱", "Inbox read"], refresh: ["收件箱已刷新", "Inbox refreshed"], view: ["收件箱视图已同步", "Inbox view synchronized"],
  respond: ["收件箱事项已响应", "Inbox item answered"], read: ["通知已标记为已读", "Notification marked read"],
  read_updates: ["通知已标记为已读", "Updates marked read"], clear_update: ["通知已清除", "Notification cleared"],
  clear_read_updates: ["已读通知已清除", "Read updates cleared"],
};
/** 进行中业务句子。 */
const running: Readonly<Record<string, readonly [string, string]>> = {
  list: ["正在读取收件箱", "Reading inbox"], refresh: ["正在刷新收件箱", "Refreshing inbox"], view: ["正在同步收件箱视图", "Synchronizing inbox view"],
  respond: ["正在响应收件箱事项", "Answering inbox item"], read: ["正在标记通知已读", "Marking notification read"],
  read_updates: ["正在标记通知已读", "Marking updates read"], clear_update: ["正在清除通知", "Clearing notification"],
  clear_read_updates: ["正在清除已读通知", "Clearing read updates"],
};
/** 普通同步保持单行，只有需要处理的错误才提供正文。 */
function describe(props: PowerActivityProps) {
  const action = action_of(props).replace(/^notification\./, "");
  const tone = call_tone(props);
  let sentence = (tone === "complete" ? completed[action] : running[action]) ?? ["收件箱操作已返回", "Inbox operation returned"];
  if (tone === "failed") sentence = ["收件箱操作失败", "Inbox operation failed"];
  if (tone === "waiting") sentence = ["收件箱操作等待确认", "Inbox operation awaiting confirmation"];
  return { title: sentence[chinese(props.locale) ? 0 : 1]!, tone, has_detail: action !== "list" && tone === "failed" && Boolean(error_of(props)) };
}
/** 不显示 action gateway 参数、来源 ID 或内部响应结构。 */
function detail(props: PowerActivityProps) { return <ActivityText render_text={props.render_text} error={error_of(props)} />; }
/** Notification 自有活动插槽。 */
export const NOTIFICATION_ACTIVITY_RENDERER: PowerActivityRenderer = { describe, detail };
