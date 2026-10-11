/**
 * Agent Chat TUI 内联交互面板槽位。
 *
 * 槽位本身不实现任何业务选择逻辑，只负责把一个活动组件放入正常布局流，
 * 并在获得焦点时把键盘输入转交给该组件。
 */

import type { Component } from "@earendil-works/pi-tui";

/** 输入框上方或下方可复用的单组件内联槽位。 */
export class InlinePanelSlotComponent implements Component {
  private content: Component | null = null;

  /** 当前槽位是否正在展示交互组件。 */
  get is_active(): boolean {
    return this.content !== null;
  }

  /**
   * 显示指定交互组件，并替换已有内容。
   *
   * @param content 新的活动组件。
   */
  show(content: Component): void {
    this.content = content;
  }

  /** 清空当前交互组件。 */
  clear(): void {
    this.content = null;
  }

  /** 将键盘输入转交给当前活动组件。 */
  handleInput(data: string): void {
    this.content?.handleInput?.(data);
  }

  /** 渲染当前活动组件；空槽位不占据任何行。 */
  render(width: number): string[] {
    return this.content?.render(width) ?? [];
  }

  /** 通知当前活动组件清理渲染缓存。 */
  invalidate(): void {
    this.content?.invalidate();
  }
}
