/**
 * `city agent chat` 交互式终端渲染器。
 *
 * 职责说明（中文）
 * - 只服务于交互式 `city agent chat`，不参与 `--message` 一次性输出。
 * - 负责 spinner 生命周期、tool 事件可见性，以及 assistant 文本流式渲染。
 * - 把“终端展示状态机”从主命令流程中拆出，降低 `AgentChat.ts` 复杂度。
 */

import chalk from "chalk";
import type { SessionMutation } from "@downcity/agent";
import type {
  AgentChatInteractiveRenderSnapshot,
  AgentChatInteractiveRendererPort,
} from "@/city/types/AgentChatInteractive.js";
import {
  createSpinner,
  shouldRenderSpinner,
  type Spinner,
} from "@/city/utils/cli/Spinner.js";
import {
  format_tool_call_block,
  format_tool_result_block,
} from "@/city/agent/AgentChatToolFormatter.js";

/**
 * 交互式单轮渲染器。
 */
export class AgentChatInteractiveRenderer implements AgentChatInteractiveRendererPort {
  private spinner: Spinner | null = null;
  private spinner_text = "";
  private emitted_visible_text = false;
  private text_stream_open = false;
  private has_block_output = false;
  private active_turn_id = "";
  private readonly tool_call_ids = new Set<string>();
  private readonly spinner_enabled: boolean;

  constructor() {
    this.spinner_enabled = shouldRenderSpinner();
  }

  /**
   * 启动新一轮交互渲染。
   */
  start_turn(): void {
    this.active_turn_id = "";
    this.emitted_visible_text = false;
    this.text_stream_open = false;
    this.has_block_output = false;
    this.set_spinner_text("Thinking...");
  }

  /**
   * 绑定当前 turn id。
   */
  attach_turn_id(turn_id: string): void {
    this.active_turn_id = String(turn_id || "").trim();
  }

  /**
   * 渲染单个 session 事件。
   */
  render_event(event: SessionMutation): void {
    const event_turn_id = "turn_id" in event ? event.turn_id || "" : "";
    if (event_turn_id && this.active_turn_id && event_turn_id !== this.active_turn_id) {
      return;
    }

    if (event.variant === "delta") {
      if (event.type === "text") this.print_text_delta(event.delta);
      else if (event.type === "reasoning") this.set_spinner_text("Thinking...");
      return;
    }
    if (event.variant === "message") {
      if (
        event.type === "error" ||
        event.type === "assistant" && event.message.status !== "streaming"
      ) this.stop_spinner();
      return;
    }
    if (event.variant !== "part" || event.type !== "tool") return;
    const part = event.part;
    if (!this.tool_call_ids.has(part.tool_call_id)) {
      this.tool_call_ids.add(part.tool_call_id);
      this.print_tool_block(format_tool_call_block({
        tool_name: part.tool_name,
        args: part.input || {},
      }));
    }
    if (part.state === "completed" || part.state === "failed") {
      this.print_tool_block(format_tool_result_block({
        tool_name: part.tool_name,
        result:
          part.state === "completed"
            ? part.output ?? null
            : part.error || "Tool failed",
      }));
    }
    this.set_spinner_text(
      part.state === "waiting-user"
        ? "Waiting for user..."
        : part.state === "completed" || part.state === "failed"
          ? "Thinking..."
          : `Running ${part.tool_name}...`,
    );
  }

  /**
   * 结束当前一轮渲染，补齐末尾换行。
   */
  finish_turn(): AgentChatInteractiveRenderSnapshot {
    this.stop_spinner();
    if (this.text_stream_open) {
      process.stdout.write("\n\n");
      this.text_stream_open = false;
      this.has_block_output = true;
    }
    return {
      emitted_visible_text: this.emitted_visible_text,
    };
  }

  private set_spinner_text(spinner_text: string): void {
    const normalized_text = String(spinner_text || "").trim() || "Thinking...";
    if (!this.spinner_enabled) return;
    if (this.spinner && this.spinner_text === normalized_text) return;

    this.stop_spinner();
    this.spinner_text = normalized_text;
    this.spinner = createSpinner({
      text: normalized_text,
    });
    this.spinner.start();
  }

  private stop_spinner(): void {
    if (!this.spinner) return;
    this.spinner.stop();
    this.spinner = null;
  }

  private print_text_delta(text: string): void {
    if (!text) return;
    this.stop_spinner();

    if (!this.text_stream_open) {
      process.stdout.write("\n");
      this.text_stream_open = true;
    }

    process.stdout.write(text);
    this.emitted_visible_text = true;
  }

  private print_tool_block(block: {
    title: string;
    detail_lines: string[];
  }): void {
    this.stop_spinner();

    if (this.text_stream_open) {
      process.stdout.write("\n\n");
      this.text_stream_open = false;
    } else if (this.has_block_output) {
      process.stdout.write("\n");
    }

    console.log(chalk.cyan(block.title));
    for (const detail_line of block.detail_lines) {
      console.log(chalk.dim(`  ${detail_line}`));
    }
    this.has_block_output = true;
  }
}
