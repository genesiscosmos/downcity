/**
 * 提示消息组件。
 *
 * 关键点（中文）
 * - 直接从 Kimi Code 的 status-message.ts 挪用。
 * - 继承 Container，顶部带 Spacer，支持 invalidate 重新染色。
 * - 标题使用 error 语义色，详情使用 textDim。
 */

import { Container, Spacer, Text } from "@earendil-works/pi-tui";

import { current_theme } from "@/city/agent/tui/theme/index.js";

/**
 * 渲染一条提示消息。
 */
export class NoticeMessageComponent extends Container {
  private title_text: Text;
  private detail_text?: Text;
  private title: string;
  private detail?: string;

  /**
   * @param title 标题文本。
   * @param detail 可选详情文本。
   */
  constructor(title: string, detail?: string) {
    super();
    this.title = title;
    this.detail = detail;
    this.addChild(new Spacer(1));
    this.title_text = new Text(
      `  ${current_theme.bold_fg("error", title)}`,
      0,
      0,
    );
    this.addChild(this.title_text);
    if (detail !== undefined && detail.length > 0) {
      this.detail_text = new Text(
        `  ${current_theme.fg("textDim", detail)}`,
        0,
        0,
      );
      this.addChild(this.detail_text);
    }
  }

  /**
   * 主题切换时重新染色。
   */
  override invalidate(): void {
    this.title_text.setText(`  ${current_theme.bold_fg("error", this.title)}`);
    if (this.detail_text !== undefined && this.detail !== undefined) {
      this.detail_text.setText(
        `  ${current_theme.fg("textDim", this.detail)}`,
      );
    }
    super.invalidate();
  }
}
