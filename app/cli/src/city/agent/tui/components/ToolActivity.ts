/**
 * Chat TUI Assistant 内部的 Tool Call 组件。
 *
 * 组件展示 Tool 注册名称、canonical 状态和经过筛选的基础输入字段，
 * 不展示参数 JSON、Tool output、错误详情或折叠内容。
 */

import {
  truncateToWidth,
  type Component,
} from "@earendil-works/pi-tui";
import type { SessionAssistantToolPart } from "@downcity/agent";

import {
  BRAILLE_SPINNER_FRAMES,
  MESSAGE_INDENT,
} from "@/city/agent/tui/constant/rendering.js";
import { FAILURE_MARK, SUCCESS_MARK } from "@/city/agent/tui/constant/symbols.js";
import { present_tool_activity } from "@/city/agent/tui/presentation/ToolActivityPresentation.js";
import { current_theme } from "@/city/agent/tui/theme/index.js";

/** 渲染并原位更新 Assistant Message 内的一次 Tool Call。 */
export class ToolActivityComponent implements Component {
  private part: SessionAssistantToolPart;

  /** @param part 初次渲染的 canonical Tool Part 快照。 */
  constructor(part: SessionAssistantToolPart) {
    this.part = structuredClone(part);
  }

  /** 使用最新 canonical Tool Part 原位更新状态。 */
  update_part(part: SessionAssistantToolPart): void {
    this.part = structuredClone(part);
  }

  /** 组件不缓存 ANSI 渲染结果。 */
  invalidate(): void {
    // 所有展示信息均在 render 时从 canonical 快照重新投影。
  }

  /** 渲染不带边框的 Tool 名称、状态与基础输入字段。 */
  render(width: number): string[] {
    const safe_width = Math.max(1, width);
    const presentation = present_tool_activity(this.part);
    const mark = this.render_state_mark();
    const state = this.render_state_label(
      presentation.state_label,
      presentation.tone,
    );
    const tool_name = current_theme.fg("textStrong", presentation.tool_name);
    const header = `${MESSAGE_INDENT}${mark} ${current_theme.dim_fg("textMuted", "Tool · ")}${tool_name}${current_theme.dim_fg("textMuted", " · ")}${state}`;
    const label_width = presentation.fields.reduce(
      (maximum, item) => Math.max(maximum, item.label.length),
      0,
    );
    const detail_indent = MESSAGE_INDENT + MESSAGE_INDENT;
    const detail_lines = presentation.fields.map((item) => {
      const label = item.label.padEnd(label_width, " ");
      return `${detail_indent}${current_theme.dim_fg("textMuted", label)}  ${current_theme.fg("text", item.value)}`;
    });
    return [header, ...detail_lines]
      .map((line) => truncateToWidth(line, safe_width, "…"));
  }

  /** 根据 canonical 状态渲染状态符号。 */
  private render_state_mark(): string {
    switch (this.part.state) {
      case "waiting-user":
        return current_theme.bold_fg("warning", "!");
      case "completed":
        return current_theme.fg("success", SUCCESS_MARK.trim());
      case "failed":
        return current_theme.fg("error", FAILURE_MARK.trim());
      default:
        return current_theme.fg("primary", get_activity_frame());
    }
  }

  /** 根据展示语义渲染状态文本。 */
  private render_state_label(
    state_label: string,
    tone: "active" | "waiting" | "success" | "error",
  ): string {
    switch (tone) {
      case "waiting":
        return current_theme.bold_fg("warning", state_label);
      case "success":
        return current_theme.fg("textDim", state_label);
      case "error":
        return current_theme.bold_fg("error", state_label);
      case "active":
        return current_theme.fg("textStrong", state_label);
    }
  }
}

/** 根据当前时间计算运行态动画帧。 */
function get_activity_frame(): string {
  const frame_index = Math.floor(Date.now() / 80) % BRAILLE_SPINNER_FRAMES.length;
  return BRAILLE_SPINNER_FRAMES[frame_index] ?? BRAILLE_SPINNER_FRAMES[0];
}
