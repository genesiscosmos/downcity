/**
 * Assistant Message 角色容器组件。
 *
 * 一个组件对应一个 canonical Assistant Message，并按 Part sequence 渲染可见文本
 * 与 Tool Call。Tool 不再作为 Transcript 顶层条目，因此即使没有正文也能保持
 * Assistant 所有权；Interaction 等 Part 仍保留在条目中，由专用交互面板处理。
 */

import { Markdown, truncateToWidth, type Component } from "@earendil-works/pi-tui";

import { ToolActivityComponent } from "@/city/agent/tui/components/ToolActivity.js";
import {
  BRAILLE_SPINNER_FRAMES,
  MESSAGE_INDENT,
} from "@/city/agent/tui/constant/rendering.js";
import { current_theme } from "@/city/agent/tui/theme/index.js";
import { createMarkdownTheme } from "@/city/agent/tui/theme/pi-tui-theme.js";
import type { SessionAssistantMessage } from "@downcity/agent";

/** 缓存一个文本类 Part 的 Markdown 组件及其源文本。 */
interface TextPartView {
  /** 当前缓存对应的完整文本。 */
  text: string;
  /** 负责实际 Markdown 布局与 ANSI 渲染的组件。 */
  component: Markdown;
}

/** 渲染并原位更新一条 Assistant Message。 */
export class AssistantMessageComponent implements Component {
  private message: SessionAssistantMessage;
  private readonly text_views = new Map<string, TextPartView>();
  private readonly tool_views = new Map<string, ToolActivityComponent>();

  /** @param message 初次渲染的 canonical Assistant Message 快照。 */
  constructor(message: SessionAssistantMessage) {
    this.message = structuredClone(message);
    this.synchronize_part_views();
  }

  /** 使用最新 canonical Assistant Message 快照原位更新角色容器。 */
  update_message(message: SessionAssistantMessage): void {
    this.message = structuredClone(message);
    this.synchronize_part_views();
  }

  /** 主题切换后重建带 ANSI 缓存的 Markdown 组件。 */
  invalidate(): void {
    this.text_views.clear();
    this.synchronize_part_views();
  }

  /** 按 canonical Part 顺序渲染 Assistant 标题、正文与 Tool Call。 */
  render(width: number): string[] {
    const safe_width = Math.max(0, width);
    if (safe_width <= 0) return [""];

    const visible_parts = this.message.parts.filter((part) => {
      if (part.type === "tool") return true;
      return (
        (part.type === "text" || part.type === "reasoning") &&
        part.text.trim().length > 0
      );
    });
    const streaming = this.message.status === "streaming";
    if (visible_parts.length === 0 && !streaming) return [];

    const role = current_theme.bold_fg("primary", "Assistant");
    const waiting_for_user = this.message.parts.some((part) =>
      (part.type === "tool" && part.state === "waiting-user") ||
      (part.type === "interaction" && part.status === "pending")
    );
    const state = waiting_for_user
      ? current_theme.bold_fg("warning", " · waiting for you")
      : streaming
        ? current_theme.dim_fg("primary", ` · ${get_working_frame()} working`)
        : "";
    const lines: string[] = ["", `${role}${state}`];
    for (const part of visible_parts) {
      if (part.type === "text" || part.type === "reasoning") {
        const view = this.text_views.get(part.part_id);
        if (!view) continue;
        const content_width = Math.max(1, safe_width - MESSAGE_INDENT.length);
        if (part.type === "reasoning") {
          lines.push(MESSAGE_INDENT + current_theme.dim_fg("textDim", "Reasoning"));
        }
        for (const content_line of view.component.render(content_width)) {
          lines.push(
            MESSAGE_INDENT + (
              part.type === "reasoning"
                ? current_theme.dim_fg("textDim", content_line)
                : content_line
            ),
          );
        }
        continue;
      }
      if (part.type === "tool") {
        const view = this.tool_views.get(part.part_id);
        if (view) lines.push(...view.render(safe_width));
      }
    }

    return lines.map((line) => truncateToWidth(line, safe_width, "…"));
  }

  /** 同步 Part 组件缓存，并移除 canonical Message 中已不存在的旧 Part。 */
  private synchronize_part_views(): void {
    const current_part_ids = new Set(this.message.parts.map((part) => part.part_id));
    for (const part_id of this.text_views.keys()) {
      if (!current_part_ids.has(part_id)) this.text_views.delete(part_id);
    }
    for (const part_id of this.tool_views.keys()) {
      if (!current_part_ids.has(part_id)) this.tool_views.delete(part_id);
    }

    for (const part of this.message.parts) {
      if (part.type === "text" || part.type === "reasoning") {
        const current = this.text_views.get(part.part_id);
        if (current?.text === part.text) continue;
        this.text_views.set(part.part_id, {
          text: part.text,
          component: new Markdown(part.text.trim(), 0, 0, createMarkdownTheme()),
        });
        continue;
      }
      if (part.type === "tool") {
        const current = this.tool_views.get(part.part_id);
        if (current) current.update_part(part);
        else this.tool_views.set(part.part_id, new ToolActivityComponent(part));
      }
    }
  }
}

/** 根据当前时间计算 working 动画帧；重绘节拍由 StreamingUIController 驱动。 */
function get_working_frame(): string {
  const frame_index = Math.floor(Date.now() / 80) % BRAILLE_SPINNER_FRAMES.length;
  return BRAILLE_SPINNER_FRAMES[frame_index] ?? BRAILLE_SPINNER_FRAMES[0];
}
