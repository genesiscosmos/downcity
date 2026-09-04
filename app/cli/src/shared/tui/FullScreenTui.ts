/**
 * 确定性全屏刷新的 pi-tui 运行时。
 *
 * 本模块保留 pi-tui 的组件树、焦点、输入分发、编辑器光标和同步输出能力，只将
 * 每次刷新提升为强制全帧重绘。Chat 的内容会持续改变可视窗口起点，差分刷新无法
 * 安全修改已经离开 viewport 的旧行；全帧刷新让终端屏幕始终只呈现当前组件快照。
 */

import { TUI, type Terminal } from "@earendil-works/pi-tui";

/** 始终清理当前屏幕并完整绘制最新组件树的 TUI。 */
export class FullScreenTui extends TUI {
  private full_render_scheduled = false;

  /** @param terminal 负责实际终端 I/O 与屏幕生命周期的 Terminal。 */
  constructor(terminal: Terminal) {
    super(terminal);
  }

  /**
   * 请求一次完整重绘。
   *
   * 同一事件循环内的重复请求先在本层合并，再通过 pi-tui synchronized output
   * 一次写入清屏和完整帧，因此流式 Mutation 不会暴露中间清屏状态。
   */
  override requestRender(_force = false): void {
    if (this.full_render_scheduled) return;
    this.full_render_scheduled = true;
    process.nextTick(() => {
      super.requestRender(true);
      process.nextTick(() => {
        this.full_render_scheduled = false;
      });
    });
  }
}
