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
  handle_agent_session_closed(agent_id: string, workspace_id: string, session_id: string): void {
    this.controller.mark_target_read({ kind: "agent_session", agent_id, workspace_id, session_id });
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
}
