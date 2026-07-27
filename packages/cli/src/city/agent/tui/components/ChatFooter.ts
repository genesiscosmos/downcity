/**
 * Agent Chat TUI 底部操作栏。
 *
 * Header 已承担 Session 与运行上下文，本组件只展示当前可执行操作；当用户离开
 * transcript 底部时，优先展示历史阅读状态和返回最新消息的方法。
 */

import { truncateToWidth, type Component } from "@earendil-works/pi-tui";

import { current_theme } from "@/city/agent/tui/theme/index.js";
import type { AppState } from "@/city/agent/tui/types.js";

/** 完整快捷键提示的最小宽度。 */
const WIDE_HINT_MIN_WIDTH = 88;

/** 中等快捷键提示的最小宽度。 */
const MEDIUM_HINT_MIN_WIDTH = 54;

/**
 * 输入框下方的操作与 transcript 滚动状态栏。
 */
export class ChatFooterComponent implements Component {
  private app_state: AppState;

  /** @param app_state 初始应用状态。 */
  constructor(app_state: AppState) {
    this.app_state = app_state;
  }

  /** @param app_state 最新应用状态。 */
  set_state(app_state: AppState): void {
    this.app_state = app_state;
  }

  /** 操作栏不维护 ANSI 渲染缓存。 */
  invalidate(): void {
    // 所有颜色均在 render 时从当前主题读取。
  }

  /**
   * 渲染当前最重要的操作提示。
   *
   * @param width 可用终端宽度。
   * @returns 单行操作提示。
   */
  render(width: number): string[] {
    const safe_width = Math.max(1, width);
    const hint = this.app_state.transcript_scroll_offset > 0
      ? this.build_history_hint()
      : this.build_action_hint(safe_width);
    return [truncateToWidth(` ${hint}`, safe_width, "…")];
  }

  /** 构建历史阅读状态。 */
  private build_history_hint(): string {
    const offset = this.app_state.transcript_scroll_offset;
    const label = current_theme.bold_fg("primary", `↑ HISTORY · ${offset} lines`);
    const action = current_theme.dim_fg("textMuted", "↓ / PgDn return · Ctrl+L latest");
    return `${label}  ${action}`;
  }

  /** 根据终端宽度构建空闲或执行态快捷键。 */
  private build_action_hint(width: number): string {
    if (this.app_state.is_executing) {
      const queued_count = this.app_state.queued_message_count;
      const queue = current_theme.bold_fg(
        "primary",
        queued_count > 0 ? `Enter queue · ${queued_count} queued` : "Enter queue",
      );
      const stop = current_theme.bold_fg("warning", "Ctrl+C stop");
      const rest = width >= MEDIUM_HINT_MIN_WIDTH
        ? "↑ edit queue · ↑/↓ scroll"
        : "↑/↓ scroll";
      return `${queue}  ${stop}  ${current_theme.dim_fg("textMuted", rest)}`;
    }
    if (width >= WIDE_HINT_MIN_WIDTH) {
      return current_theme.dim_fg(
        "textMuted",
        "Enter send   ↑/↓ scroll   PgUp/PgDn page   / commands",
      );
    }
    if (width >= MEDIUM_HINT_MIN_WIDTH) {
      return current_theme.dim_fg(
        "textMuted",
        "Enter send · ↑/↓ scroll · /help",
      );
    }
    return current_theme.dim_fg("textMuted", "Enter send · /help");
  }
}
