/**
 * Session 内联审批面板。
 *
 * 关键点（中文）
 * - 普通 Tool 与 unrestricted sandbox 请求共用决策交互，但展示各自的真实字段。
 * - 上下方向键选择，Enter 确认，Esc / Ctrl+C 按安全语义拒绝请求。
 * - 与 SessionPicker 风格一致：primary 色边框、指针、底部 hint。
 */

import {
  matchesKey,
  Key,
  truncateToWidth,
  type Component,
  type Focusable,
} from "@earendil-works/pi-tui";

import { SELECT_POINTER } from "@/city/agent/tui/constant/symbols.js";
import { current_theme } from "@/city/agent/tui/theme/index.js";
import type {
  ApprovalPanelDetail,
  ApprovalPanelOptions,
} from "@/city/agent/tui/types.js";

const BORDER_HORIZONTAL = "─";
const ELLIPSIS = "…";

/**
 * 审批决策结果。
 */
export type ApprovalDecision = "approve" | "deny";

/**
 * 内联审批选择面板。
 */
export class ApprovalPanelComponent implements Component, Focusable {
  private readonly approval_id: string;
  private readonly approval_type: "tool" | "shell";
  private readonly tool_name: string;
  private readonly details: ApprovalPanelDetail[];
  private readonly on_decide: (decision: ApprovalDecision) => void;
  private selected_index = 0;

  focused = false;

  /**
   * @param params 面板参数。
   */
  constructor(params: ApprovalPanelOptions) {
    this.approval_id = params.approval_id;
    this.approval_type = params.approval_type;
    this.tool_name = params.tool_name;
    this.details = params.details;
    this.on_decide = params.on_decide;
  }

  /**
   * 处理键盘输入。
   *
   * @param data pi-tui 输入数据。
   */
  handleInput(data: string): void {
    if (matchesKey(data, Key.up) || matchesKey(data, Key.down)) {
      this.selected_index = this.selected_index === 0 ? 1 : 0;
      return;
    }
    if (matchesKey(data, Key.enter)) {
      this.on_decide(this.selected_index === 0 ? "approve" : "deny");
      return;
    }
    if (
      matchesKey(data, Key.escape) ||
      matchesKey(data, "ctrl+c") ||
      matchesKey(data, "ctrl+d")
    ) {
      this.on_decide("deny");
      return;
    }
  }

  /**
   * 渲染审批面板。
   *
   * @param width 可用宽度。
   * @returns 渲染后的行数组。
   */
  render(width: number): string[] {
    const safe_width = Math.max(0, width);
    if (safe_width <= 0) {
      return [""];
    }

    const inner_width = Math.max(1, safe_width - 2);
    const lines: string[] = [];

    lines.push(current_theme.fg("primary", BORDER_HORIZONTAL.repeat(safe_width)));
    lines.push(this.render_title(inner_width));
    lines.push("");
    lines.push(this.render_detail(inner_width, "tool", this.tool_name));
    for (const detail of this.details) {
      lines.push(this.render_detail(inner_width, detail.label, detail.value));
    }
    lines.push("");
    lines.push(this.render_option(inner_width, "Approve", 0));
    lines.push(this.render_option(inner_width, "Deny", 1));
    lines.push("");
    lines.push(this.render_hint(inner_width));
    lines.push(current_theme.fg("primary", BORDER_HORIZONTAL.repeat(safe_width)));

    return lines.map((line) => truncateToWidth(line, safe_width, ELLIPSIS));
  }

  /**
   * 无缓存需要清理。
   */
  invalidate(): void {
    // 面板内容不变，无需刷新。
  }

  private render_title(inner_width: number): string {
    const title = current_theme.bold_fg(
      "accent",
      ` ${this.approval_type === "tool" ? "Tool approval" : "Unrestricted sandbox approval"} · ${this.approval_id} `,
    );
    return " " + truncateToWidth(title, inner_width, ELLIPSIS);
  }

  private render_detail(inner_width: number, label: string, value: string): string {
    const colored_label = current_theme.bold_fg("text", `${label}: `);
    const line = ` ${colored_label}${value}`;
    return truncateToWidth(line, inner_width, ELLIPSIS);
  }

  private render_option(inner_width: number, label: string, index: number): string {
    const is_selected = this.selected_index === index;
    const pointer = is_selected
      ? current_theme.fg("primary", `${SELECT_POINTER} `)
      : "  ";
    const colored_label = is_selected
      ? current_theme.bold_fg("primary", label)
      : current_theme.fg("text", label);
    return " " + truncateToWidth(`${pointer}${colored_label}`, inner_width, ELLIPSIS);
  }

  private render_hint(inner_width: number): string {
    const hint = "↑↓ navigate · Enter confirm · Esc deny";
    return " " + truncateToWidth(current_theme.dim_fg("textMuted", hint), inner_width, ELLIPSIS);
  }
}
