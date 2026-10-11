/**
 * Chat TUI 的 alternate-screen Terminal Adapter。
 *
 * 本模块只拥有终端屏幕切换生命周期。输入、窗口尺寸、光标、标题和实际输出仍由
 * pi-tui 的 ProcessTerminal 负责，Chat 的组件树与差分渲染逻辑不需要感知屏幕模式。
 */

import {
  ProcessTerminal,
  type Terminal,
} from "@earendil-works/pi-tui";

const ENTER_ALTERNATE_SCREEN = "\u001B[?1049h";
const LEAVE_ALTERNATE_SCREEN = "\u001B[?1049l";

/** 在独立终端屏幕中运行 pi-tui，并在停止时恢复原屏幕。 */
export class AlternateScreenTerminal implements Terminal {
  private readonly terminal: Terminal;
  private started = false;
  private alternate_screen_active = false;

  /** @param terminal 实际负责终端 I/O 的 pi-tui Terminal。 */
  constructor(terminal: Terminal = new ProcessTerminal()) {
    this.terminal = terminal;
  }

  /** 进入 alternate screen 后启动底层终端输入生命周期。 */
  start(
    on_input: (data: string) => void,
    on_resize: () => void,
  ): void {
    if (this.started) return;
    this.enter_alternate_screen();
    try {
      this.terminal.start(on_input, on_resize);
      this.started = true;
    } catch (error) {
      this.leave_alternate_screen();
      throw error;
    }
  }

  /** 停止底层终端，并保证主屏幕始终得到恢复。 */
  stop(): void {
    if (!this.started && !this.alternate_screen_active) return;
    try {
      if (this.started) this.terminal.stop();
    } finally {
      this.started = false;
      this.leave_alternate_screen();
    }
  }

  /** 排空底层终端输入。 */
  async drainInput(max_ms?: number, idle_ms?: number): Promise<void> {
    await this.terminal.drainInput(max_ms, idle_ms);
  }

  /** 写入底层终端。 */
  write(data: string): void {
    this.terminal.write(data);
  }

  /** 当前终端列数。 */
  get columns(): number {
    return this.terminal.columns;
  }

  /** 当前终端行数。 */
  get rows(): number {
    return this.terminal.rows;
  }

  /** 底层终端是否启用了 Kitty 键盘协议。 */
  get kittyProtocolActive(): boolean {
    return this.terminal.kittyProtocolActive;
  }

  /** 相对移动光标行。 */
  moveBy(lines: number): void {
    this.terminal.moveBy(lines);
  }

  /** 隐藏光标。 */
  hideCursor(): void {
    this.terminal.hideCursor();
  }

  /** 显示光标。 */
  showCursor(): void {
    this.terminal.showCursor();
  }

  /** 清除当前行。 */
  clearLine(): void {
    this.terminal.clearLine();
  }

  /** 清除光标到屏幕末尾。 */
  clearFromCursor(): void {
    this.terminal.clearFromCursor();
  }

  /** 清除当前屏幕。 */
  clearScreen(): void {
    this.terminal.clearScreen();
  }

  /** 设置终端标题。 */
  setTitle(title: string): void {
    this.terminal.setTitle(title);
  }

  /** 设置终端进度状态。 */
  setProgress(active: boolean): void {
    this.terminal.setProgress(active);
  }

  /** 切换到不会写入 shell scrollback 的独立屏幕。 */
  private enter_alternate_screen(): void {
    if (this.alternate_screen_active) return;
    this.terminal.write(ENTER_ALTERNATE_SCREEN);
    this.alternate_screen_active = true;
  }

  /** 返回进入 Chat TUI 前的主屏幕。 */
  private leave_alternate_screen(): void {
    if (!this.alternate_screen_active) return;
    this.terminal.write(LEAVE_ALTERNATE_SCREEN);
    this.alternate_screen_active = false;
  }
}
