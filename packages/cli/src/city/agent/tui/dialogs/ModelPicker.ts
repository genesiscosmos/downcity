/**
 * Chat TUI Session 模型内联选择器。
 *
 * 候选项来自 City AIService 模型目录；选择器只提交稳定 model_id，不持有模型实例。
 */

import {
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Component,
  type Focusable,
} from "@earendil-works/pi-tui";

import { SESSION_PICKER_MAX_VISIBLE } from "@/city/agent/tui/constant/rendering.js";
import { CURRENT_MARK, SELECT_POINTER } from "@/city/agent/tui/constant/symbols.js";
import { current_theme } from "@/city/agent/tui/theme/index.js";
import { singleLine } from "@/city/agent/tui/utils/text.js";
import { resolve_tui_visible_scroll } from "@/shared/tui/TuiText.js";
import type {
  AgentChatModelChoice,
  AgentChatModelPickerOptions,
} from "@/city/types/AgentChatModel.js";

const BORDER_HORIZONTAL = "─";
const ELLIPSIS = "…";

/** 输入框下方的 Session 模型选择器。 */
export class ModelPickerComponent implements Component, Focusable {
  private readonly choices: AgentChatModelChoice[];
  private filtered_choices: AgentChatModelChoice[];
  private readonly current_model_label: string;
  private readonly on_select: AgentChatModelPickerOptions["on_select"];
  private readonly on_cancel: AgentChatModelPickerOptions["on_cancel"];
  private selected_index = 0;
  private scroll_offset = 0;
  private query = "";

  focused = false;

  /** @param options 模型目录、当前模型与选择回调。 */
  constructor(options: AgentChatModelPickerOptions) {
    this.choices = [...options.choices];
    this.filtered_choices = [...this.choices];
    this.current_model_label = String(options.current_model_label || "").trim();
    this.on_select = options.on_select;
    this.on_cancel = options.on_cancel;
    const current_index = this.choices.findIndex((choice) => this.is_current(choice));
    this.selected_index = Math.max(0, current_index);
  }

  /** 使用方向键导航、文本搜索、Enter 确认、Esc 取消。 */
  handleInput(data: string): void {
    if (matchesKey(data, Key.up) || matchesKey(data, Key.down)) {
      this.move_selection(matchesKey(data, Key.up) ? -1 : 1);
      return;
    }
    if (matchesKey(data, Key.enter)) {
      const choice = this.filtered_choices[this.selected_index];
      if (choice) this.on_select(choice.model_id);
      return;
    }
    if (matchesKey(data, Key.escape) || matchesKey(data, "ctrl+c")) {
      if (this.query) {
        this.query = "";
        this.apply_filter();
      } else {
        this.on_cancel();
      }
      return;
    }
    if (matchesKey(data, Key.backspace)) {
      if (this.query) {
        this.query = this.query.slice(0, -1);
        this.apply_filter();
      }
      return;
    }
    if (data.length === 1 && data.charCodeAt(0) >= 32 && data.charCodeAt(0) <= 126) {
      this.query += data;
      this.apply_filter();
    }
  }

  /** 渲染可搜索模型目录。 */
  render(width: number): string[] {
    const safe_width = Math.max(1, width);
    const inner_width = Math.max(1, safe_width - 2);
    const visible_choices = this.visible_choices();
    const lines = [
      current_theme.fg("primary", BORDER_HORIZONTAL.repeat(safe_width)),
      ` ${current_theme.bold_fg("primary", " Select Session model ")}${current_theme.dim_fg("textMuted", " (type to search)")}`,
      ` ${current_theme.dim_fg("textMuted", "↑↓ navigate · Enter apply · Esc cancel")}`,
      ...(this.query
        ? [` ${current_theme.fg("primary", "Search: ")}${this.query}`]
        : [""]),
    ];

    if (visible_choices.length === 0) {
      lines.push("  No matching models");
    } else {
      for (const choice of visible_choices) lines.push(this.render_choice(choice, inner_width));
    }
    const used_lines = Math.max(1, visible_choices.length);
    for (let index = used_lines; index < SESSION_PICKER_MAX_VISIBLE; index += 1) lines.push("");
    if (this.filtered_choices.length > SESSION_PICKER_MAX_VISIBLE) {
      lines.push(` ${current_theme.fg("textMuted", `${this.selected_index + 1} / ${this.filtered_choices.length}`)}`);
    } else {
      lines.push("");
    }
    lines.push(current_theme.fg("primary", BORDER_HORIZONTAL.repeat(safe_width)));
    return lines.map((line) => truncateToWidth(line, safe_width, ELLIPSIS));
  }

  /** 选择器不维护 ANSI 渲染缓存。 */
  invalidate(): void {
    // 所有样式均在 render 时读取当前主题。
  }

  /** 根据当前搜索词更新候选和滚动位置。 */
  private apply_filter(): void {
    const query = this.query.toLowerCase();
    this.filtered_choices = query
      ? this.choices.filter((choice) =>
          [choice.model_id, choice.name, ...choice.modalities]
            .some((value) => singleLine(value).toLowerCase().includes(query)),
        )
      : [...this.choices];
    this.selected_index = Math.min(
      this.selected_index,
      Math.max(0, this.filtered_choices.length - 1),
    );
    this.sync_scroll();
  }

  /** 循环移动当前选择。 */
  private move_selection(direction: number): void {
    const count = this.filtered_choices.length;
    if (count === 0) return;
    this.selected_index = (this.selected_index + direction + count) % count;
    this.sync_scroll();
  }

  /** 返回当前滚动窗口内的候选。 */
  private visible_choices(): AgentChatModelChoice[] {
    this.sync_scroll();
    return this.filtered_choices.slice(
      this.scroll_offset,
      this.scroll_offset + SESSION_PICKER_MAX_VISIBLE,
    );
  }

  /** 校准当前滚动偏移。 */
  private sync_scroll(): void {
    this.scroll_offset = resolve_tui_visible_scroll({
      selected_index: this.selected_index,
      scroll_offset: this.scroll_offset,
      viewport_height: SESSION_PICKER_MAX_VISIBLE,
      item_count: this.filtered_choices.length,
    });
  }

  /** 渲染单个模型候选。 */
  private render_choice(choice: AgentChatModelChoice, inner_width: number): string {
    const selected = this.filtered_choices[this.selected_index]?.model_id === choice.model_id;
    const pointer = selected ? `${SELECT_POINTER} ` : "  ";
    const current = this.is_current(choice) ? ` ${CURRENT_MARK}` : "";
    const label = choice.name === choice.model_id
      ? choice.model_id
      : `${choice.name} · ${choice.model_id}`;
    const modalities = choice.modalities.join("/");
    const description = modalities ? current_theme.fg("textDim", modalities) : "";
    const available = Math.max(1, inner_width - visibleWidth(pointer) - visibleWidth(description) - 1);
    const visible_label = truncateToWidth(label + current, available, ELLIPSIS);
    const styled_label = selected
      ? current_theme.bold_fg("primary", visible_label)
      : current_theme.fg("text", visible_label);
    const padding = Math.max(1, inner_width - visibleWidth(pointer + visible_label + description));
    return `${pointer}${styled_label}${" ".repeat(padding)}${description}`;
  }

  /** 判断目录项是否对应当前 Session 模型。 */
  private is_current(choice: AgentChatModelChoice): boolean {
    return this.current_model_label === choice.model_id ||
      this.current_model_label === choice.name;
  }
}
