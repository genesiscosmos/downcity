/**
 * Agent Chat Slash 命令内联帮助面板。
 *
 * 帮助内容固定显示在输入框下方，不写入 transcript；Enter、Esc 或 Ctrl+C
 * 关闭面板并把焦点交还给编辑器。
 */

import {
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Component,
} from "@earendil-works/pi-tui";

import { BUILTIN_SLASH_COMMANDS } from "@/city/agent/tui/commands/registry.js";
import { current_theme } from "@/city/agent/tui/theme/index.js";

/** Slash 命令帮助内联面板。 */
export class CommandHelpPanelComponent implements Component {
  private readonly on_close: () => void;

  /** @param on_close 用户关闭面板时触发。 */
  constructor(on_close: () => void) {
    this.on_close = on_close;
  }

  /** Enter、Esc 与 Ctrl+C 均关闭帮助面板。 */
  handleInput(data: string): void {
    if (
      matchesKey(data, Key.enter) ||
      matchesKey(data, Key.escape) ||
      matchesKey(data, "ctrl+c")
    ) {
      this.on_close();
    }
  }

  /** 渲染命令名称、别名和简短说明。 */
  render(width: number): string[] {
    const safe_width = Math.max(1, width);
    const lines = [
      current_theme.fg("primary", "─".repeat(safe_width)),
      ` ${current_theme.bold_fg("primary", " Slash commands ")}`,
      current_theme.dim_fg("textMuted", " Enter / Esc close"),
    ];
    for (const command of BUILTIN_SLASH_COMMANDS) {
      const aliases = command.aliases.length > 0 ? ` (${command.aliases.join(", ")})` : "";
      const label = `/${command.name}${aliases}`;
      const max_label_width = Math.min(24, Math.max(10, Math.floor(safe_width * 0.32)));
      const visible_label = truncateToWidth(label, max_label_width, "…");
      const gap = Math.max(2, max_label_width - visibleWidth(visible_label) + 2);
      lines.push(
        ` ${current_theme.bold_fg("textStrong", visible_label)}${" ".repeat(gap)}${current_theme.fg("textDim", command.description)}`,
      );
    }
    lines.push(current_theme.fg("primary", "─".repeat(safe_width)));
    return lines.map((line) => truncateToWidth(line, safe_width, "…"));
  }

  /** 面板不维护 ANSI 渲染缓存。 */
  invalidate(): void {
    // 所有样式均在 render 时读取当前主题。
  }
}
