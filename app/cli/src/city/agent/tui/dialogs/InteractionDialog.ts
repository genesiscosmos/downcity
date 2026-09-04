/**
 * 未注册 Interaction 类型的通用 TUI 面板。
 *
 * CLI 不猜测动态 payload 的业务语义；用户只能明确拒绝并结束等待，
 * 需要自定义输入时由宿主注册对应 renderer。
 */

import { Key, matchesKey, truncateToWidth, type Component, type Focusable } from "@earendil-works/pi-tui";
import type { SessionInteractionRequest } from "@downcity/agent";
import { current_theme } from "@/city/agent/tui/theme/index.js";

const BORDER_HORIZONTAL = "─";

export interface GenericInteractionPanelOptions {
  /** 动态 Interaction 请求。 */
  request: SessionInteractionRequest;
  /** 用户拒绝该 Interaction。 */
  on_deny: () => void;
}

export class GenericInteractionPanelComponent implements Component, Focusable {
  focused = false;

  constructor(private readonly options: GenericInteractionPanelOptions) {}

  handleInput(data: string): void {
    if (matchesKey(data, Key.enter) || matchesKey(data, Key.escape) || matchesKey(data, "ctrl+c") || matchesKey(data, "ctrl+d")) {
      this.options.on_deny();
    }
  }

  render(width: number): string[] {
    const safe_width = Math.max(0, width);
    if (safe_width <= 0) return [""];
    const payload = format_payload(this.options.request.payload);
    return [
      BORDER_HORIZONTAL.repeat(safe_width),
      truncateToWidth(` ${this.options.request.title || this.options.request.type} `, safe_width, "…"),
      truncateToWidth(` type: ${this.options.request.type}`, safe_width, "…"),
      ...payload.map((line) => truncateToWidth(` ${line}`, safe_width, "…")),
      truncateToWidth(current_theme.dim_fg("textMuted", "Enter / Esc deny · custom renderer required"), safe_width, "…"),
      BORDER_HORIZONTAL.repeat(safe_width),
    ];
  }

  invalidate(): void {}
}

function format_payload(payload: unknown): string[] {
  try {
    const value = JSON.stringify(payload, null, 2) || "{}";
    return value.split("\n").slice(0, 8);
  } catch {
    return [String(payload)];
  }
}
