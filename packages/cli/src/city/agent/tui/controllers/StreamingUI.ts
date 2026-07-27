/**
 * canonical Session Mutation 到 Chat TUI Transcript 的实时控制器。
 *
 * 控制器按 message_id 定位 canonical Message，按 part_id 更新 Assistant Part。
 * Message 创建 Mutation 必须先于对应 Part/Delta；TUI 不构造缺少领域字段的占位消息。
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
  private active_turn_id = "";
  private pending_render = false;
  private render_timer: ReturnType<typeof setTimeout> | null = null;
  private last_render_at = 0;
  private working_spinner_timer: ReturnType<typeof setInterval> | null = null;

  /** @param options 控制器依赖与重绘回调。 */
  constructor(options: StreamingUIOptions) {
    this.message_list = options.message_list;
    this.request_render_fn = options.request_render;
  }

  /** 启动新一轮；Assistant 容器在首个 canonical Message/Part/Delta 到达时创建。 */
  start_turn(): void {
    this.active_turn_id = "";
    this.pending_render = false;
    this.clear_render_timer();
    this.start_working_spinner();
    this.request_render_fn();
  }

  /** @param turn_id 当前 Session Turn 的稳定标识。 */
  attach_turn_id(turn_id: string): void {
    this.active_turn_id = String(turn_id || "").trim();
  }

  /** 按 Mutation 身份更新 Assistant Message 或其他顶层状态条目。 */
  handle_event(event: SessionMutation): void {
    const event_turn_id = "turn_id" in event ? event.turn_id || "" : "";
    if (event_turn_id && this.active_turn_id && event_turn_id !== this.active_turn_id) {
      return;
    }

    if (event.variant === "delta") {
      if (event.type !== "text") return;
      this.message_list.append_assistant_delta(
        event.message_id,
        event.part_id,
        event.delta,
        event.revision,
        event.created_at,
      );
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

  /** 结束当前轮次并停止动画；终态 Message Mutation 是状态的首选事实来源。 */
  finish_turn(): void {
    this.flush_render();
    this.stop_working_spinner();
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
