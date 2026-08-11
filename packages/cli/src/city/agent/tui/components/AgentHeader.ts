/**
 * Agent Chat TUI 顶部上下文栏。
 *
 * 固定展示产品与当前 Session；执行中的 working 状态归属 Assistant 消息流，
 * 避免把回复状态与对话内容分离到右上角。
 */

import { truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";

import { current_theme } from "@/city/agent/tui/theme/index.js";
import type { AppState } from "@/city/agent/tui/types.js";

/** 单行 Header 的最小终端宽度。 */
const SINGLE_LINE_MIN_WIDTH = 72;

/**
 * Agent Chat 顶部上下文组件。
 */
export class AgentHeaderComponent implements Component {
  private app_state: AppState;

  /** @param app_state 初始应用状态。 */
  constructor(app_state: AppState) {
    this.app_state = app_state;
  }

  /** @param app_state 最新应用状态。 */
  set_state(app_state: AppState): void {
    this.app_state = app_state;
  }

  /** Header 不维护 ANSI 渲染缓存。 */
  invalidate(): void {
    // 所有颜色均在 render 时从当前主题读取。
  }

  /**
   * 渲染顶部上下文栏。
   *
   * @param width 可用终端宽度。
   * @returns Header 行数组。
   */
  render(width: number): string[] {
    const safe_width = Math.max(1, width);
    const brand = current_theme.bold_fg("textStrong", "DOWNCITY AGENT");
    const context = current_theme.dim_fg("textDim", this.build_context());
    const divider = current_theme.fg("border", "─".repeat(safe_width));
    const left = `${brand}  ${context}`;

    if (safe_width < SINGLE_LINE_MIN_WIDTH || visibleWidth(left) > safe_width) {
      return [
        truncateToWidth(brand, safe_width, "…"),
        truncateToWidth(context, safe_width, "…"),
        divider,
      ];
    }

    return [truncateToWidth(left, safe_width, "…"), divider];
  }

  /** 构建 Session 与模型上下文。 */
  private build_context(): string {
    const title = this.app_state.session_title?.trim() || "Untitled";
    const model = this.app_state.model_label?.trim() || "Loading";
    const configured_mode = this.app_state.security?.approval_mode;
    const security_policy = configured_mode === "always-allow"
      ? "Always Allow"
      : configured_mode === "ask"
        ? "Default"
        : "Loading";
    const pending = this.app_state.security &&
        this.app_state.security.approval_mode !== this.app_state.security.effective_approval_mode
      ? " (queued)"
      : "";
    return `${title} · Model: ${model} · Security: ${security_policy}${pending} · ${this.app_state.session_id}`;
  }
}
