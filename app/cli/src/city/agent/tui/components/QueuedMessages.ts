/**
 * 执行期间的本地排队消息展示组件。
 *
 * 关键点（中文）
 * - 位于编辑器上方，明确展示尚未发送到远端 Session 的消息。
 * - 只保留最近三条预览，避免大量排队消息挤占 transcript 可视区。
 * - 所有实际队列数据由协调器持有，本组件不处理键盘或网络行为。
 */

import { truncateToWidth, type Component } from "@earendil-works/pi-tui";

import { current_theme } from "@/city/agent/tui/theme/index.js";
import type { QueuedInput } from "@/city/agent/tui/types.js";

/** 最多展示的排队消息预览数量。 */
const MAX_VISIBLE_QUEUED_MESSAGES = 3;

/**
 * 编辑器上方的排队消息预览。
 */
export class QueuedMessagesComponent implements Component {
  private queued_inputs: readonly QueuedInput[] = [];

  /**
   * 更新当前渲染所需的队列快照。
   *
   * @param queued_inputs 按 FIFO 顺序排列的本地输入队列。
   */
  set_queued_inputs(queued_inputs: readonly QueuedInput[]): void {
    this.queued_inputs = queued_inputs;
  }

  /** 组件不维护 ANSI 渲染缓存。 */
  invalidate(): void {
    // 颜色与内容均在 render 时即时计算。
  }

  /**
   * 渲染排队消息与召回提示。
   *
   * @param width 可用终端宽度。
   * @returns 没有排队消息时返回空数组。
   */
  render(width: number): string[] {
    if (this.queued_inputs.length === 0) return [];

    const safe_width = Math.max(1, width);
    const lines: string[] = [];
    const title = current_theme.bold_fg(
      "primary",
      `Queued · ${this.queued_inputs.length}`,
    );
    lines.push(truncateToWidth(` ${title}`, safe_width, "…"));

    const visible_inputs = this.queued_inputs.slice(-MAX_VISIBLE_QUEUED_MESSAGES);
    const hidden_count = this.queued_inputs.length - visible_inputs.length;
    if (hidden_count > 0) {
      lines.push(
        truncateToWidth(
          ` ${current_theme.dim_fg("textMuted", `… ${hidden_count} earlier message${hidden_count === 1 ? "" : "s"}`)}`,
          safe_width,
          "…",
        ),
      );
    }
    for (const queued_input of visible_inputs) {
      lines.push(
        truncateToWidth(
          ` ${current_theme.dim_fg("primary", `> ${queued_input.text}`)}`,
          safe_width,
          "…",
        ),
      );
    }
    lines.push(
      truncateToWidth(
        ` ${current_theme.dim_fg("textMuted", "↑ edit latest queued message")}`,
        safe_width,
        "…",
      ),
    );
    return lines;
  }
}
