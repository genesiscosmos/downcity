/**
 * 自动完成列表的换行版本。
 *
 * 关键点（中文）
 * - 直接从 Kimi Code 挪用：把长描述折成最多两行，而不是 pi-tui 默认的单行截断。
 * - 只覆盖 render；选择、过滤、按键处理仍由 pi-tui 的 SelectList 负责。
 */

import {
  SelectList,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type SelectItem,
  type SelectListLayoutOptions,
  type SelectListTheme,
} from "@earendil-works/pi-tui";
import { resolve_tui_visible_scroll } from "@/shared/tui/TuiText.js";

// 与 pi-tui 私有常量保持一致（dist/components/select-list.js）。
const DEFAULT_PRIMARY_COLUMN_WIDTH = 32;
const PRIMARY_COLUMN_GAP = 2;
const MIN_DESCRIPTION_WIDTH = 10;

const DESCRIPTION_MAX_LINES = 2;
const ELLIPSIS = "…";
const ELLIPSIS_WIDTH = visibleWidth(ELLIPSIS);

// truncateToWidth 在真正截断时会追加 ANSI reset；我们的文本是纯色， reset 会破坏主题着色。
const TRAILING_ANSI_RESET = /(?:\u001B\[0m)+$/g;

function truncate_plain_to_width(text: string, max_width: number): string {
  return truncateToWidth(text, max_width, "").replace(TRAILING_ANSI_RESET, "");
}

interface SelectListInternals {
  readonly filteredItems: SelectItem[];
  readonly selectedIndex: number;
  readonly maxVisible: number;
  readonly theme: SelectListTheme;
  readonly layout: SelectListLayoutOptions;
  scrollOffset?: number;
}

/**
 * 支持描述换行的 SelectList。
 */
export class WrappingSelectList extends SelectList {
  override render(width: number): string[] {
    const internals = this.internals();
    const { filteredItems, selectedIndex, maxVisible, theme } = internals;
    if (filteredItems.length === 0) {
      return [theme.noMatch("  No matching commands")];
    }

    const primary_column_width = this.primary_column_width();
    const start_index = resolve_tui_visible_scroll({
      selected_index: selectedIndex,
      scroll_offset: internals.scrollOffset ?? 0,
      viewport_height: maxVisible,
      item_count: filteredItems.length,
    });
    internals.scrollOffset = start_index;
    const end_index = Math.min(start_index + maxVisible, filteredItems.length);

    const lines: string[] = [];
    for (let i = start_index; i < end_index; i += 1) {
      const item = filteredItems[i];
      if (item === undefined) {
        continue;
      }
      lines.push(...this.render_item_lines(item, i === selectedIndex, width, primary_column_width));
    }

    if (start_index > 0 || end_index < filteredItems.length) {
      const scroll_text = `  (${selectedIndex + 1}/${filteredItems.length})`;
      lines.push(theme.scrollInfo(truncate_plain_to_width(scroll_text, width - 2)));
    }
    return lines;
  }

  private render_item_lines(
    item: SelectItem,
    is_selected: boolean,
    width: number,
    primary_column_width: number,
  ): string[] {
    const { theme } = this.internals();
    const prefix = is_selected ? "→ " : "  ";
    const prefix_width = visibleWidth(prefix);
    const description = item.description
      ? item.description.replaceAll(/[\r\n]+/g, " ").trim()
      : undefined;

    if (description && width > 40) {
      const effective_primary_width = Math.max(
        1,
        Math.min(primary_column_width, width - prefix_width - 4),
      );
      const max_primary_width = Math.max(1, effective_primary_width - PRIMARY_COLUMN_GAP);
      const truncated_value = this.truncate_primary_value(
        item,
        is_selected,
        max_primary_width,
        effective_primary_width,
      );
      const truncated_value_width = visibleWidth(truncated_value);
      const spacing = " ".repeat(Math.max(1, effective_primary_width - truncated_value_width));
      const description_start = prefix_width + truncated_value_width + spacing.length;
      const remaining_width = width - description_start - 2;
      if (remaining_width > MIN_DESCRIPTION_WIDTH) {
        const description_lines = wrap_description(description, remaining_width);
        const indent = " ".repeat(description_start);
        if (is_selected) {
          return description_lines.map((line, index) =>
            theme.selectedText(
              index === 0 ? `${prefix}${truncated_value}${spacing}${line}` : indent + line,
            ),
          );
        }
        return description_lines.map((line, index) =>
          index === 0
            ? prefix + truncated_value + theme.description(spacing + line)
            : theme.description(indent + line),
        );
      }
    }

    const max_width = width - prefix_width - 2;
    const truncated_value = this.truncate_primary_value(item, is_selected, max_width, max_width);
    return [is_selected ? theme.selectedText(`${prefix}${truncated_value}`) : prefix + truncated_value];
  }

  private truncate_primary_value(
    item: SelectItem,
    is_selected: boolean,
    max_width: number,
    column_width: number,
  ): string {
    const { layout } = this.internals();
    const display_value = item.label || item.value;
    const truncated = layout.truncatePrimary
      ? layout.truncatePrimary({
          text: display_value,
          maxWidth: max_width,
          columnWidth: column_width,
          item,
          isSelected: is_selected,
        })
      : display_value;
    return truncate_plain_to_width(truncated, max_width);
  }

  private primary_column_width(): number {
    const { filteredItems, layout } = this.internals();
    const raw_min =
      layout.minPrimaryColumnWidth ?? layout.maxPrimaryColumnWidth ?? DEFAULT_PRIMARY_COLUMN_WIDTH;
    const raw_max =
      layout.maxPrimaryColumnWidth ?? layout.minPrimaryColumnWidth ?? DEFAULT_PRIMARY_COLUMN_WIDTH;
    const min = Math.max(1, Math.min(raw_min, raw_max));
    const max = Math.max(1, Math.max(raw_min, raw_max));
    const widest = filteredItems.reduce(
      (acc, item) => Math.max(acc, visibleWidth(item.label || item.value) + PRIMARY_COLUMN_GAP),
      0,
    );
    return Math.max(min, Math.min(widest, max));
  }

  private internals(): SelectListInternals {
    return this as unknown as SelectListInternals;
  }
}

function wrap_description(text: string, width: number): string[] {
  const wrapped = wrapTextWithAnsi(text, width);
  if (wrapped.length <= DESCRIPTION_MAX_LINES) {
    return wrapped;
  }
  const kept = wrapped.slice(0, DESCRIPTION_MAX_LINES - 1);
  const rest = wrapped.slice(DESCRIPTION_MAX_LINES - 1).join(" ");
  const clipped = truncate_plain_to_width(rest, width - ELLIPSIS_WIDTH).trimEnd();
  return [...kept, `${clipped}${ELLIPSIS}`];
}
