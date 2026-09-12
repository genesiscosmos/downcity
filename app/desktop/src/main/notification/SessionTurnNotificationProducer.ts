/**
 * 将 Agent Session 运行态中需要用户注意的落点转换为通用 Desktop Notification。
 *
 * 一个 Session 只保留一条未读通知，并始终反映最近一次需要关注的落点：交互等待、
 * 执行失败或对话完成。这样未读角标统计的是「需要处理的 Session 数」而不是事件数。
 */

import type { DesktopChatRuntime, DesktopChatRuntimeStatus } from "../../common/types/DesktopApi.js";
import type { DesktopNotificationKind } from "../../common/types/DesktopNotification.js";
import type { DesktopNotificationPublisher } from "../types/notification/Notification.js";

/** 需要产生通知的 Session 运行态落点。 */
type SessionAttentionStatus = Extract<DesktopChatRuntimeStatus, "waiting_input" | "failed" | "completed">;

/** 每个落点对应的通知类型与用户可见标题。 */
const attention_notification: Record<SessionAttentionStatus, { kind: DesktopNotificationKind; title: string }> = {
  waiting_input: { kind: "session_turn_waiting_input", title: "对话等待你的输入" },
  failed: { kind: "session_turn_failed", title: "对话执行失败" },
  completed: { kind: "session_turn_completed", title: "对话已完成" },
};

/** 读取运行态对应的注意力落点；无需关注的运行态返回 null。 */
function get_attention_status(status: DesktopChatRuntimeStatus): SessionAttentionStatus | null {
  return status === "waiting_input" || status === "failed" || status === "completed" ? status : null;
}

/** 判断注意力落点是否为不可再被回退的终态。 */
function is_terminal_attention(status: SessionAttentionStatus): boolean {
  return status === "failed" || status === "completed";
}

/** 监听 Session 运行态，并把每个 Turn 的注意力落点收敛成一条未读通知。 */
export class SessionTurnNotificationProducer {
  /** 通用 Desktop 通知发布端口。 */
  private readonly notifications: DesktopNotificationPublisher;
  /** 每个 Session 最近一次已通知的 Turn 与落点，用于去重并阻止终态回退。 */
  private readonly last_attention_by_topic = new Map<string, { turn_id: string; status: SessionAttentionStatus }>();

  constructor(notifications: DesktopNotificationPublisher) {
    this.notifications = notifications;
  }

  /** 消费一条 Session 运行态；不需要关注的落点会收回尚未查看的等待输入通知。 */
  handle_runtime(runtime: DesktopChatRuntime): void {
    const topic_key = `session_turn:agent_session:${runtime.agent_id}:${runtime.workspace_id}:${runtime.session_id}`;
    const previous = this.last_attention_by_topic.get(topic_key);
    const attention_status = get_attention_status(runtime.status);

    if (!attention_status) {
      // 交互被自动处理、Session 停止等原因让等待输入不再成立时，同步收回未查看的通知。
      if (previous?.status === "waiting_input") {
        this.last_attention_by_topic.delete(topic_key);
        this.notifications.mark_topic_read(topic_key);
      }
      return;
    }
    // 缺少 Turn 标识时无法判断重复事件，宁可漏发也不重复打扰用户。
    if (!runtime.turn_id) return;
    if (previous?.turn_id === runtime.turn_id) {
      if (previous.status === attention_status) return;
      // 收口事件可能晚于终态到达，终态通知不能被回退成等待输入。
      if (is_terminal_attention(previous.status) && !is_terminal_attention(attention_status)) return;
    }

    this.last_attention_by_topic.set(topic_key, { turn_id: runtime.turn_id, status: attention_status });
    const { kind, title } = attention_notification[attention_status];
    this.notifications.publish({
      kind,
      topic_key,
      target: {
        kind: "agent_session",
        agent_id: runtime.agent_id,
        workspace_id: runtime.workspace_id,
        session_id: runtime.session_id,
      },
      scopes: [{ kind: "agent", agent_id: runtime.agent_id }],
      title,
      created_at: runtime.updated_at,
    });
  }
}
