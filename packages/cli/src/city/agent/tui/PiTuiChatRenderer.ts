/**
 * 基于 pi-tui 的交互式 chat 渲染器。
 *
 * 关键点（中文）
 * - 实现 AgentChatInteractiveRendererPort，接入 AgentChat 的 runSdkPromptTurn。
 * - 把 SDK 事件转交给 StreamingUIController，驱动消息流更新。
 */

import type { SessionMutation } from "@downcity/agent";

import type {
  AgentChatInteractiveRenderSnapshot,
  AgentChatInteractiveRendererPort,
} from "@/city/types/AgentChatInteractive.js";
import { StreamingUIController } from "@/city/agent/tui/controllers/StreamingUI.js";
import type { MessageListComponent } from "@/city/agent/tui/components/MessageList.js";

/**
 * pi-tui 版交互式渲染器。
 */
export class PiTuiChatRenderer implements AgentChatInteractiveRendererPort {
  private streaming_ui: StreamingUIController;
  private emitted_visible_text = false;
  on_approval_request?: AgentChatInteractiveRendererPort["on_approval_request"];

  /**
   * @param message_list 消息流组件。
   * @param request_render 通知 TUI 重绘的回调。
   * @param on_approval_request approval 内联面板回调。
   */
  constructor(
    message_list: MessageListComponent,
    request_render: () => void,
    on_approval_request?: AgentChatInteractiveRendererPort["on_approval_request"],
  ) {
    this.streaming_ui = new StreamingUIController({
      message_list,
      request_render,
    });
    this.on_approval_request = on_approval_request;
  }

  /**
   * 启动新一轮渲染。
   */
  start_turn(): void {
    this.emitted_visible_text = false;
    this.streaming_ui.start_turn();
  }

  /**
   * 绑定当前 turn id。
   *
   * @param turn_id turn id。
   */
  attach_turn_id(turn_id: string): void {
    this.streaming_ui.attach_turn_id(turn_id);
  }

  /**
   * 渲染单个 session 事件。
   *
   * @param event Session Mutation。
   */
  render_event(event: SessionMutation): void {
    this.streaming_ui.handle_event(event);
    if (
      event.variant === "delta" &&
      event.type === "text" &&
      event.delta.trim()
    ) {
      this.emitted_visible_text = true;
    }
    if (event.variant !== "part" || event.type !== "interaction") return;
    const interaction = event.part;
    const request = interaction.request;
    if (
      interaction.interaction_type !== "approval" ||
      interaction.status !== "pending" ||
      request.kind !== "approval" ||
      request.source.type !== "tool"
    ) return;
    this.on_approval_request?.({
      approval_id: interaction.interaction_id,
      tool_name: request.source.tool_name,
      cmd: request.command,
      cwd: request.cwd,
      reason: request.reason,
    });
  }

  /**
   * 结束当前一轮渲染。
   *
   * @returns 渲染结果快照。
   */
  finish_turn(): AgentChatInteractiveRenderSnapshot {
    this.streaming_ui.finish_turn();
    return {
      emitted_visible_text: this.emitted_visible_text,
    };
  }
}
