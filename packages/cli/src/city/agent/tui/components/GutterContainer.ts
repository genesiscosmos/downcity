/**
 * 带左右边距的容器。
 *
 * 关键点（中文）
 * - 直接从 Kimi Code 挪用：在内容两侧保留固定列数的空白边距。
 * - 内部组件按 `width - left - right` 渲染，每行前缀补 `left` 个空格。
 * - 右侧边距是逻辑上的，不输出尾随空格，避免 diff 渲染器无意义刷新。
 */

import { Container } from "@earendil-works/pi-tui";

/**
 * 边距容器。
 */
export class GutterContainer extends Container {
  /**
   * @param left_pad 左侧空白列数。
   * @param right_pad 右侧空白列数。
   */
  constructor(
    private readonly left_pad: number,
    private readonly right_pad: number,
  ) {
    super();
  }

  /**
   * 渲染带边距的内容。
   *
   * @param width 可用宽度。
   * @returns 渲染后的行数组。
   */
  override render(width: number): string[] {
    const inner_width = Math.max(1, width - this.left_pad - this.right_pad);
    const lead = " ".repeat(this.left_pad);
    const out: string[] = [];
    for (const child of this.children) {
      for (const line of child.render(inner_width)) {
        out.push(lead + line);
      }
    }
    return out;
  }
}
