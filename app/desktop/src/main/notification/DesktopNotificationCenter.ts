/**
 * Desktop Notification 领域门面。
 *
 * 本对象拥有通知状态与各生产者的共同生命周期，并把 Electron 组合根中的业务事件
 * 收敛为通知领域操作；调用方不需要理解通知存储、聚合或生产者实现。
 */

import type { DesktopChatRuntime, DesktopGroupEvent } from "../../common/types/DesktopApi.js";
import type {
  DesktopNotificationState,
  DesktopNotificationViewState,
} from "../../common/types/DesktopNotification.js";
import type {
  DesktopNotificationBadge,
  DesktopNotificationEvents,
  DesktopNotificationStorage,
  DesktopPowerNotificationInput,
} from "../types/notification/Notification.js";
import { NotificationController } from "./NotificationController.js";
import { GroupNotificationProducer } from "./GroupNotificationProducer.js";
import { PowerNotificationProducer } from "./PowerNotificationProducer.js";
import { SessionTurnNotificationProducer } from "./SessionTurnNotificationProducer.js";
import { get_agent_session_target_key, get_group_session_target_key } from "./notification_target_key.js";

/** Desktop 通知状态、生产与生命周期清理的唯一主进程入口。 */
export class DesktopNotificationCenter {
  /** 通知状态与副作用的唯一事实源。 */
  private readonly controller: NotificationController;
  /** Session Turn 完成事件生产者。 */
  private readonly session_turn_producer: SessionTurnNotificationProducer;
  /** GroupSession 待处理交互与失败事件生产者。 */
  private readonly group_producer: GroupNotificationProducer;
  /** 受宿主身份约束的 Power 通知生产者。 */
  private readonly power_producer: PowerNotificationProducer;

  constructor(
    storage: DesktopNotificationStorage,
    badge: DesktopNotificationBadge,
    events: DesktopNotificationEvents,
  ) {
    this.controller = new NotificationController(storage, badge, events);
    this.session_turn_producer = new SessionTurnNotificationProducer(this.controller);
    this.group_producer = new GroupNotificationProducer(this.controller);
    this.power_producer = new PowerNotificationProducer(this.controller);
  }

  /** 返回当前完整未读状态。 */
  get_state(): DesktopNotificationState {
    return this.controller.get_state();
  }

  /** 更新一个 Renderer 当前实际可见的通知目标。 */
  set_view_state(view_id: number, state: DesktopNotificationViewState): void {
    this.controller.set_view_state(view_id, state);
  }

  /** Renderer 销毁时释放其观察状态。 */
  remove_view(view_id: number): void {
    this.controller.remove_view(view_id);
  }

  /** 消费 Session 运行态并在需要用户注意的落点产生通知。 */
  handle_session_runtime(runtime: DesktopChatRuntime): void {
    this.session_turn_producer.handle_runtime(runtime);
  }

  /** 消费 GroupSession 事件并在需要用户注意的落点产生通知。 */
  handle_group_event(event: DesktopGroupEvent): void {
    this.group_producer.handle_event(event);
  }

  /** 发布 Desktop City Power 产生的宿主通知。 */
  publish_power_notification(power_id: string, input: DesktopPowerNotificationInput): void {
    this.power_producer.publish(power_id, input);
  }

  /** 发布 Power 在当前执行范围产生并由宿主绑定 Agent 身份的通知。 */
  publish_agent_power_notification(
    power_id: string,
    agent_id: string,
    input: DesktopPowerNotificationInput,
  ): void {
    this.power_producer.publish(power_id, input, agent_id);
  }

  /** 清除一个 Power 本地主题对应的未读通知。 */
  dismiss_power_notification(power_id: string, topic_key: string): void {
    this.power_producer.dismiss(power_id, topic_key);
  }

  /** Session 被归档或删除后清理其精确目标通知。 */
  handle_agent_session_closed(agent_id: string, workspace_id: string, session_id: string, origin_type: string): void {
    this.controller.mark_target_read({ kind: "agent_session", agent_id, workspace_id, session_id, origin_type });
  }

  /**
   * Session 换绑 Workspace 后清理它的旧目标通知。
   *
   * 换绑后通知里记录的 `workspace_id` 已成旧值，完整目标匹配不再成立，
   * 因此按 `agent_id + session_id` 定位；否则会留下一个“图标在报警、行内却安静”的幽灵通知。
   */
  handle_agent_session_rebound(agent_id: string, session_id: string): void {
    this.controller.mark_agent_session_read(agent_id, session_id);
  }

  /** Workspace 移除后清理其下全部 Session 通知，避免 Rail 红点指向看不见的会话。 */
  handle_workspace_removed(workspace_id: string): void {
    this.controller.mark_workspace_read(workspace_id);
  }

  /** GroupSession 被删除后清理其精确目标通知。 */
  handle_group_session_closed(group_id: string, session_id: string): void {
    this.controller.mark_target_read({ kind: "group_session", group_id, session_id });
  }

  /** Agent 删除后清理其 Session 和 Power 执行范围产生的全部通知。 */
  handle_agent_removed(agent_id: string): void {
    this.controller.mark_scope_read({ kind: "agent", agent_id });
  }

  /** Group 删除后清理其全部 GroupSession 通知。 */
  handle_group_removed(group_id: string): void {
    this.controller.mark_scope_read({ kind: "group", group_id });
  }

  /**
   * 用当前真实目录对账，清除指向已不存在对象的未读通知，返回清除数量。
   *
   * 事件驱动的收口只能覆盖用户此刻正在操作的路径：应用未运行时发生的归档、
   * 删除或换绑不会补发事件。启动时对账一次，历史幽灵红点才会自己消失。
   * Power 通知由各自插件自己负责，不在这里判断。
   */
  reconcile_existing_targets(existing: {
    /** 仍存在的 Agent Session：`agent_id` + `workspace_id` + `session_id` 的拼合键集合。 */
    agent_session_keys: ReadonlySet<string>;
    /** 仍存在的 GroupSession：`group_id` + `session_id` 的拼合键集合。 */
    group_session_keys: ReadonlySet<string>;
    /** 本轮无法枚举的 Agent；指向它们的通知一律保留，宁漏不误删。 */
    unresolved_agent_ids: ReadonlySet<string>;
    /** 本轮无法枚举的 Group；指向它们的通知一律保留。 */
    unresolved_group_ids: ReadonlySet<string>;
  }): number {
    return this.controller.prune_targets((target) => {
      if (target.kind === "agent_session") {
        if (existing.unresolved_agent_ids.has(target.agent_id)) return true;
        return existing.agent_session_keys.has(get_agent_session_target_key(target.agent_id, target.workspace_id, target.session_id, target.origin_type));
      }
      if (target.kind === "group_session") {
        if (existing.unresolved_group_ids.has(target.group_id)) return true;
        return existing.group_session_keys.has(get_group_session_target_key(target.group_id, target.session_id));
      }
      // Power 通知由各自插件自己负责，不在这里判断。
      return true;
    });
  }
}
