/**
 * 状态消息组件。
 *
 * 关键点（中文）
 * - 直接从 Kimi Code 的 status-message.ts 挪用。
 * - 继承 Container，支持 invalidate 时重新染色。
 * - 文本前缩进 2 个空格，与 bullet 对齐。
 */

import { Container, Text } from "@earendil-works/pi-tui";

import { current_theme } from "@/city/agent/tui/theme/index.js";
import type { ColorToken } from "@/city/agent/tui/theme/theme.js";

/**
 * 渲染一条状态消息。
 */
export class StatusMessageComponent extends Container {
  private text_component: Text;
  private content: string;
  private color?: ColorToken;

  /**
   * @param content 状态文本。
   * @param color 颜色 token，未指定时使用 textDim。
   */
  constructor(content: string, color?: ColorToken) {
    super();
    this.content = content;
    this.color = color;
    const text =
      color === undefined
        ? current_theme.fg("textDim", content)
        : current_theme.fg(color, content);
    this.text_component = new Text(`  ${text}`, 0, 0);
    this.addChild(this.text_component);
  }

  /**
   * 主题切换时重新染色。
   */
  override invalidate(): void {
    const text =
      this.color === undefined
        ? current_theme.fg("textDim", this.content)
        : current_theme.fg(this.color, this.content);
    this.text_component.setText(`  ${text}`);
    super.invalidate();
  }
}
