/**
 * 用户消息组件。
 *
 * 关键点（中文）
 * - 使用独立角色标签建立对话层级，正文保持高可读中性色。
 * - 文本按可用宽度自动换行，并与角色标签保持稳定缩进。
 */

import { Spacer, Text, truncateToWidth, type Component } from "@earendil-works/pi-tui";

import { MESSAGE_INDENT } from "@/city/agent/tui/constant/rendering.js";
import { current_theme } from "@/city/agent/tui/theme/index.js";

/**
 * 渲染一条用户消息。
 */
export class UserMessageComponent implements Component {
  private readonly text: string;
  private readonly spacer: Spacer;

  /**
   * @param text 用户输入文本。
   */
  constructor(text: string) {
    this.text = text;
    this.spacer = new Spacer(1);
  }

  /**
   * 组件无需缓存清理。
   */
  invalidate(): void {
    // 文本不变，无需刷新。
  }

  /**
   * 渲染用户消息。
   *
   * @param width 可用宽度。
   * @returns 渲染后的行数组。
   */
  render(width: number): string[] {
    const safe_width = Math.max(0, width);
    if (safe_width <= 0) {
      return [""];
    }

    const lines: string[] = [];

    // 关键点（中文）：对齐 Kimi Code，组件顶部自带 1 行间距。
    for (const line of this.spacer.render(safe_width)) {
      lines.push(line);
    }

    lines.push(current_theme.bold_fg("roleUser", "You"));
    const content_width = Math.max(1, safe_width - MESSAGE_INDENT.length);
    const text_lines = new Text(current_theme.fg("textStrong", this.text), 0, 0)
      .render(content_width);
    for (const line of text_lines) {
      lines.push(MESSAGE_INDENT + line);
    }

    return lines.map((line) => truncateToWidth(line, safe_width, "…"));
  }
}
