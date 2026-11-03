/**
 * Inbox Renderer 的只读输入与受信宿主表单端口。
 * 普通响应由 Notification Power 代理，私密值只交给宿主专用入口。
 */
import type { ReactNode } from "react";
import type { AgentInteraction } from "@downcity/agent";
import type { RespondSessionInteractionInput } from "@downcity/type";
import type { NotificationItem } from "./Notification.js";

/** 一个 Agent 原交互及其展示身份。 */
export interface NotificationInteractionItem {
  /** 原交互所属 Agent 的稳定标识。 */
  agent_id: string;
  /** 当前 Agent 的用户可见名称。 */
  agent_name: string;
  /** 原 Session canonical 快照、完整来源引用与 can_respond；为 false 时仅展示中断提示，禁止挂载可提交表单。 */
  interaction: AgentInteraction;
}

/** notification.list 返回的完整 Inbox 快照。 */
export interface NotificationListResult {
  /** 当前主体目录的显示名称；更新来源独立于是否存在待处理请求。 */
  agent_names: Record<string, string>;
  /** 普通更新；已读状态由 Notification Power 持久化。 */
  items: NotificationItem[];
  /** 当前所有 Agent 尚待处理的原交互。 */
  interactions: NotificationInteractionItem[];
  /** 暂时无法查询的 Agent；界面必须提示部分结果不可用。 */
  unavailable_agents: string[];
}

/** 宿主可选注入现有 Interaction 控件及专用私密传输。 */
export interface NotificationRendererOptions {
  /** 用户明确查看时打开原Session；只传引用，不提供新执行权限。 */
  open_interaction?: (item: NotificationInteractionItem) => Promise<void>;
  /** 用户明确查看时打开通知关联的结果或业务页面。 */
  open_notification?: (item: NotificationItem) => Promise<void>;
  /** 仅为 can_respond 为 true 的原请求挂载表单；控件提交时须标明是否包含私密问题。 */
  render_interaction?: (item: NotificationInteractionItem, respond: (input: RespondSessionInteractionInput, private_question?: boolean) => Promise<void>) => ReactNode;
  /** 受信宿主直接提交到原 Session，禁止转发到普通 Power action。 */
  submit_private?: (item: NotificationInteractionItem, input: RespondSessionInteractionInput) => Promise<void>;
}
