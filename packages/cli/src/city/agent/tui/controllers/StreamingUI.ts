/**
 * canonical Session Mutation 到 Chat TUI Transcript 的实时投影器。
 *
 * 控制器按 message_id 定位 canonical Message，按 part_id 更新 Assistant Part。
 * Session 订阅生命周期由 Coordinator 持有；本模块只合并消息相关 Mutation 并控制重绘节拍。
 */

import type { SessionMutation } from "@downcity/agent";

import type { MessageListComponent } from "@/city/agent/tui/components/MessageList.js";
import { BRAILLE_SPINNER_INTERVAL_MS } from "@/city/agent/tui/constant/rendering.js";
import { STREAMING_UI_FLUSH_MS } from "@/city/agent/tui/constant/streaming.js";

/** StreamingUIController 构造选项。 */
export interface StreamingUIOptions {
  /** 消息流组件。 */
  message_list: MessageListComponent;
  /** TUI 请求重绘回调；高频 Mutation 会按固定节拍合并。 */
  request_render: () => void;
}

/** 将 Session Mutation 投影到 Assistant-owned Transcript。 */
export class StreamingUIController {
  private readonly message_list: MessageListComponent;
  private readonly request_render_fn: () => void;
  private pending_render = false;
  private render_timer: ReturnType<typeof setTimeout> | null = null;
  private last_render_at = 0;
  private working_spinner_timer: ReturnType<typeof setInterval> | null = null;

  /** @param options 控制器依赖与重绘回调。 */
  constructor(options: StreamingUIOptions) {
    this.message_list = options.message_list;
    this.request_render_fn = options.request_render;
  }

  /** 按 Mutation 身份更新 Message 或 Assistant Part。 */
  handle_event(event: SessionMutation): void {
    if (event.variant === "delta") {
      if (event.type === "text" || event.type === "reasoning") {
        this.message_list.append_assistant_text_delta(
          event.message_id,
          event.part_id,
          event.type,
          event.delta,
          event.revision,
          event.created_at,
        );
      } else if (event.type === "tool_input") {
        this.message_list.append_tool_input_delta(
          event.message_id,
          event.part_id,
          event.tool_call_id,
          event.delta,
          event.revision,
          event.created_at,
        );
      } else {
        return;
      }
      this.schedule_render();
      return;
    }

    if (event.variant === "part") {
      this.message_list.upsert_assistant_part(
        event.message_id,
        event.part,
        event.revision,
        event.created_at,
      );
      this.schedule_render();
      return;
    }

    if (event.variant !== "message") return;
    this.message_list.upsert_message(event.message);
    this.schedule_render();
  }

  /** 立即提交尚未绘制的变更并释放动画计时器。 */
  dispose(): void {
    this.flush_render();
    this.stop_working_spinner();
  }

  /** 根据当前 Session 是否执行中维护 working 动画。 */
  set_executing(is_executing: boolean): void {
    if (is_executing) this.start_working_spinner();
    else this.stop_working_spinner();
    this.request_render_fn();
  }

  /** 合并高频 Mutation 产生的终端重绘请求。 */
  private schedule_render(): void {
    this.pending_render = true;
    if (this.render_timer !== null) return;
    const elapsed = Date.now() - this.last_render_at;
    const delay = elapsed >= STREAMING_UI_FLUSH_MS
      ? 0
      : STREAMING_UI_FLUSH_MS - elapsed;
    this.render_timer = setTimeout(() => this.flush_render(), delay);
  }

  /** 立即提交一次已经排队的重绘。 */
  private flush_render(): void {
    this.clear_render_timer();
    if (!this.pending_render) return;
    this.pending_render = false;
    this.last_render_at = Date.now();
    this.request_render_fn();
  }

  /** 取消尚未执行的合并重绘定时器。 */
  private clear_render_timer(): void {
    if (this.render_timer === null) return;
    clearTimeout(this.render_timer);
    this.render_timer = null;
  }

  /** 启动 Assistant working 与 Tool active 状态的低频动画重绘。 */
  private start_working_spinner(): void {
    if (this.working_spinner_timer !== null) return;
    const timer = setInterval(() => {
      this.request_render_fn();
    }, BRAILLE_SPINNER_INTERVAL_MS);
    if (typeof timer.unref === "function") timer.unref();
    this.working_spinner_timer = timer;
  }

  /** 当前 Turn 结束后停止动画重绘。 */
  private stop_working_spinner(): void {
    if (this.working_spinner_timer === null) return;
    clearInterval(this.working_spinner_timer);
    this.working_spinner_timer = null;
  }
}
