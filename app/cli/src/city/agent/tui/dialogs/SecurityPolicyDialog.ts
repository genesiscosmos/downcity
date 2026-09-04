/**
 * Chat TUI Session 安全策略内联选择器。
 *
 * 选择器只负责展示和提交 canonical SessionApprovalMode，不在 TUI 内复制审批
 * 规则。Default 映射为 ask；Always Allow 映射为 always-allow。
 */

import {
  Key,
  matchesKey,
  truncateToWidth,
  type Component,
  type Focusable,
} from "@earendil-works/pi-tui";
import type { SessionApprovalMode } from "@downcity/agent";

import { CURRENT_MARK, SELECT_POINTER } from "@/city/agent/tui/constant/symbols.js";
import { current_theme } from "@/city/agent/tui/theme/index.js";

const BORDER_HORIZONTAL = "─";
const ELLIPSIS = "…";

/** 安全策略选择器构造参数。 */
export interface SecurityPolicyPanelOptions {
  /** 当前 Session 正在使用的 canonical 审批模式。 */
  current_mode: SessionApprovalMode;
  /** 用户确认新模式后的回调。 */
  on_select: (mode: SessionApprovalMode) => void;
  /** 用户取消选择后的回调。 */
  on_cancel: () => void;
}

/** 输入框下方的 Session 安全策略选择器。 */
export class SecurityPolicyPanelComponent implements Component, Focusable {
  private readonly current_mode: SessionApprovalMode;
  private readonly on_select: SecurityPolicyPanelOptions["on_select"];
  private readonly on_cancel: SecurityPolicyPanelOptions["on_cancel"];
  private selected_index: number;

  focused = false;

  /** @param options 当前策略和选择器回调。 */
  constructor(options: SecurityPolicyPanelOptions) {
    this.current_mode = options.current_mode;
    this.on_select = options.on_select;
    this.on_cancel = options.on_cancel;
    this.selected_index = options.current_mode === "always-allow" ? 1 : 0;
  }

  /** 使用方向键选择，Enter 确认，Esc 或 Ctrl+C 取消。 */
  handleInput(data: string): void {
    if (matchesKey(data, Key.up) || matchesKey(data, Key.down)) {
      this.selected_index = this.selected_index === 0 ? 1 : 0;
      return;
    }
    if (matchesKey(data, Key.enter)) {
      this.on_select(this.selected_index === 0 ? "ask" : "always-allow");
      return;
    }
    if (matchesKey(data, Key.escape) || matchesKey(data, "ctrl+c")) {
      this.on_cancel();
    }
  }

  /** 渲染两种 Session 安全策略和它们的权限含义。 */
  render(width: number): string[] {
    const safe_width = Math.max(1, width);
    const lines = [
      current_theme.fg("primary", BORDER_HORIZONTAL.repeat(safe_width)),
      ` ${current_theme.bold_fg("primary", " Security policy ")}`,
      "",
      this.render_option(
        0,
        "Default",
        "Ask before every unrestricted Shell action",
        "ask",
      ),
      this.render_option(
        1,
        "Always Allow",
        "Automatically approve future unrestricted Shell actions",
        "always-allow",
      ),
      "",
      ` ${current_theme.dim_fg("textMuted", "↑↓ navigate · Enter apply · Esc cancel")}`,
      current_theme.fg("primary", BORDER_HORIZONTAL.repeat(safe_width)),
    ];
    return lines.map((line) => truncateToWidth(line, safe_width, ELLIPSIS));
  }

  /** 选择器不维护 ANSI 渲染缓存。 */
  invalidate(): void {
    // 所有样式均在 render 时读取当前主题。
  }

  /** 渲染一个带当前态和选中态的策略选项。 */
  private render_option(
    index: number,
    label: string,
    description: string,
    mode: SessionApprovalMode,
  ): string {
    const selected = this.selected_index === index;
    const pointer = selected ? `${SELECT_POINTER} ` : "  ";
    const current = this.current_mode === mode ? ` ${CURRENT_MARK}` : "";
    const visible_label = selected
      ? current_theme.bold_fg("primary", label)
      : current_theme.bold_fg("textStrong", label);
    const visible_description = current_theme.dim_fg("textMuted", description);
    return ` ${pointer}${visible_label} · ${visible_description}${current}`;
  }
}
