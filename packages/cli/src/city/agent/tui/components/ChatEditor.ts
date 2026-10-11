
/**
 * 聊天输入框组件。
 *
 * 关键点（中文）
 * - 保持完整方框样式，对齐 Kimi Code 的输入面板：prompt 符号紧贴左边框，
 *   内容区从左边框后第二列开始，侧边框检测对 ANSI 转义健壮。
 * - slash 命令 token 高亮、描述换行的 slash 自动完成，以及标准应用级快捷键回调。
 */

import {
  Editor,
  isKeyRelease,
  Key,
  matchesKey,
  SelectList,
  type SelectItem,
  type TUI,
} from "@earendil-works/pi-tui";

import { BUILTIN_SLASH_COMMANDS } from "@/city/agent/tui/commands/index.js";
import { createEditorTheme } from "@/city/agent/tui/theme/pi-tui-theme.js";
import { current_theme } from "@/city/agent/tui/theme/index.js";
import { FileMentionProvider } from "@/city/agent/tui/components/editor/FileMentionProvider.js";
import { WrappingSelectList } from "@/city/agent/tui/components/editor/WrappingSelectList.js";

// oxlint-disable-next-line no-control-regex -- ESC 是匹配 ANSI SGR 转义序列所必需的。
const ANSI_SGR = /\u001B\[[0-9;]*m/g;

// paste marker 形如 [paste #1 +123 lines] / [paste #2 1234 chars]。
const PASTE_MARKER_RE = /\[paste #(\d+)(?: ((?:\+\d+ lines|\d+ chars)))?\]/g;
const BRACKET_PASTE_START = "\u001B[200~";
const BRACKET_PASTE_END = "\u001B[201~";

// Kitty keyboard protocol CSI-u 序列：ESC [ keycode ; modifier[:eventType] u。
// oxlint-disable-next-line no-control-regex
const KITTY_CSI_U = /^\u001B\[(\d+);(\d+)((?::\d+)*)u$/;
const CAPS_LOCK_BIT = 64;
const CTRL_BIT = 4;
const SHIFT_BIT = 1;

// 与 pi-tui 私有常量保持一致（dist/components/editor.js）。
const SLASH_COMMAND_SELECT_LIST_LAYOUT = {
  minPrimaryColumnWidth: 12,
  maxPrimaryColumnWidth: 32,
} as const;

interface AutocompleteListFactoryInternals {
  createAutocompleteList?: (prefix: string, items: SelectItem[]) => SelectList;
}

interface AutocompleteInternals {
  cancelAutocomplete(): void;
  readonly autocompleteAbort?: AbortController;
  readonly autocompleteDebounceTimer?: ReturnType<typeof setTimeout>;
}

/**
 * 输入框提交回调。
 */
export type ChatEditorSubmitHandler = (text: string) => void;

/**
 * 聊天输入框。
 */
export class ChatEditorComponent extends Editor {
  on_escape?: () => void;
  on_ctrl_c?: () => void;
  on_ctrl_d?: () => void;
  on_ctrl_g?: () => void;
  on_ctrl_o?: () => void;
  on_ctrl_s?: () => void;
  on_undo?: () => void;
  on_insert_newline?: () => void;
  on_text_paste?: () => void;
  on_shift_tab?: () => void;
  /** 空编辑器时按 ↑，返回 true 表示已消费。 */
  on_up_arrow_empty?: () => boolean;
  /** 空编辑器时按 ↓，返回 true 表示已消费。 */
  on_down_arrow_empty?: () => boolean;
  /**
   * 粘贴图片回调（Unix 用 Ctrl-V，Windows 用 Alt-V）。
   * 返回 true 表示已处理，false 继续走普通粘贴。
   */
  on_paste_image?: () => Promise<boolean>;

  connected_above = false;
  border_highlighted = false;

  private consuming_paste = false;
  private consume_buffer = "";
  private submit_handler?: ChatEditorSubmitHandler;

  /**
   * @param tui 所属 TUI 实例。
   */
  constructor(tui: TUI) {
    const theme = createEditorTheme();
    // Kimi Code 的方框输入框：prompt 符号紧贴左边框，
    // 符号后保留 1 列空白，续行保持相同缩进，因此总 padding 为 3。
    super(tui, theme, { paddingX: 3 });
    this.borderColor = (text: string) => theme.borderColor(text);

    // slash 命令使用 WrappingSelectList，@ 文件路径保持 pi-tui 默认 SelectList。
    (this as unknown as AutocompleteListFactoryInternals).createAutocompleteList = (
      prefix: string,
      items: SelectItem[],
    ) => {
      if (prefix.startsWith("/")) {
        return new WrappingSelectList(
          items,
          this.getAutocompleteMaxVisible(),
          theme.selectList,
          SLASH_COMMAND_SELECT_LIST_LAYOUT,
        );
      }
      return new SelectList(items, this.getAutocompleteMaxVisible(), theme.selectList);
    };

    this.setAutocompleteProvider(
      new FileMentionProvider(BUILTIN_SLASH_COMMANDS, process.cwd()),
    );

    // 输入变化时同步边框高亮：以 "/" 开头（slash 命令）时高亮为主色。
    // 对齐 Kimi Code 的 updateEditorBorderHighlight。
    this.onChange = (text: string) => {
      this.update_border_highlight(text);
    };
  }

  /**
   * 设置提交回调。
   */
  set on_submit(handler: ChatEditorSubmitHandler | undefined) {
    this.submit_handler = handler;
    this.onSubmit = (text: string) => {
      handler?.(text);
    };
  }

  /**
   * 获取提交回调。
   */
  get on_submit(): ChatEditorSubmitHandler | undefined {
    return this.submit_handler;
  }

  /**
   * 清空当前输入。
   */
  clear(): void {
    this.set_text("");
  }

  /**
   * 设置编辑器文本并同步 slash 边框状态。
   *
   * @param text 要显示在编辑器内的完整文本。
   */
  set_text(text: string): void {
    this.setText(text);
    this.update_border_highlight(text);
  }

  /**
   * 根据当前文本同步边框高亮状态。
   * 以 "/" 开头（slash 命令）时高亮为主色，否则恢复默认边框色。
   *
   * @param text 当前文本，省略时读取编辑器内容。
   */
  update_border_highlight(text?: string): void {
    const trimmed = (text ?? this.getText()).trimStart();
    const highlighted = trimmed.startsWith("/");
    this.border_highlighted = highlighted;
    this.borderColor = (s: string) =>
      current_theme.fg(highlighted ? "primary" : "border", s);
  }

  override handleInput(data: string): void {
    const normalized = normalize_caps_locked_ctrl(data);
    if (isKeyRelease(normalized)) {
      return;
    }

    // 如果刚刚展开了一个 paste marker，丢弃终端随 Ctrl-V 一起发送的 bracketed paste 尾部。
    if (this.consuming_paste) {
      this.consume_buffer += normalized;
      if (this.consume_buffer.includes(BRACKET_PASTE_END)) {
        this.consuming_paste = false;
        this.consume_buffer = "";
      }
      return;
    }

    // 光标落在已有 paste marker 上时，先展开 marker 而不是粘贴新内容。
    if (normalized.includes(BRACKET_PASTE_START) && this.expand_paste_marker_at_cursor()) {
      if (!normalized.includes(BRACKET_PASTE_END)) {
        this.consuming_paste = true;
      }
      return;
    }

    // 粘贴图片：Windows 终端保留 Ctrl-V 做自带粘贴，用 Alt-V。
    const paste_key = process.platform === "win32" ? "alt+v" : Key.ctrl("v");
    if (matchesKey(normalized, paste_key)) {
      if (this.expand_paste_marker_at_cursor()) {
        return;
      }
      if (this.on_paste_image !== undefined) {
        const handler = this.on_paste_image;
        void handler().then((handled) => {
          if (!handled) {
            this.on_text_paste?.();
            super.handleInput.call(this, normalized);
          }
        });
        return;
      }
    }

    if (matchesKey(normalized, Key.ctrl("d"))) {
      if (this.getText().length === 0) {
        this.on_ctrl_d?.();
        return;
      }
    }

    if (matchesKey(normalized, Key.ctrl("c"))) {
      this.on_ctrl_c?.();
      return;
    }

    if (matchesKey(normalized, Key.ctrl("g"))) {
      this.on_ctrl_g?.();
      return;
    }

    if (matchesKey(normalized, Key.ctrl("o"))) {
      this.on_ctrl_o?.();
      return;
    }

    if (matchesKey(normalized, Key.ctrl("s"))) {
      this.on_ctrl_s?.();
      return;
    }

    const newline_input = get_newline_input(normalized);
    if (newline_input !== undefined) {
      this.on_insert_newline?.();
      super.handleInput(newline_input);
      return;
    }

    if (matchesKey(normalized, "shift+tab")) {
      this.on_shift_tab?.();
      return;
    }

    if (matchesKey(normalized, Key.ctrl("-"))) {
      this.on_undo?.();
    }

    if (matchesKey(normalized, Key.up)) {
      if (this.getText().length === 0 && this.on_up_arrow_empty) {
        if (this.on_up_arrow_empty()) return;
      }
    }

    if (matchesKey(normalized, Key.down)) {
      if (this.getText().length === 0 && this.on_down_arrow_empty) {
        if (this.on_down_arrow_empty()) return;
      }
    }

    if (matchesKey(normalized, Key.escape)) {
      if (this.has_autocomplete_activity()) {
        this.cancel_autocomplete_activity();
        return;
      }
      this.on_escape?.();
      return;
    }

    super.handleInput(normalized);
  }

  /**
   * 覆写渲染，注入 prompt 符号、高亮 slash 命令，并补全边框。
   */
  override render(width: number): string[] {
    const lines = super.render(width);
    if (lines.length < 3) {
      return lines;
    }

    const first_content_index = 1;
    const text = this.getText().trimStart();
    if (text.startsWith("/")) {
      const original = lines[first_content_index];
      if (original !== undefined) {
        const highlighted = highlight_first_slash_token(original);
        if (highlighted !== undefined) {
          lines[first_content_index] = highlighted;
        }
      }
    }

    const first_content = lines[first_content_index];
    if (first_content !== undefined) {
      const with_prompt = inject_prompt_symbol(first_content);
      if (with_prompt !== undefined) {
        lines[first_content_index] = with_prompt;
      }
    }

    return wrap_with_side_borders(lines, (s) => this.borderColor(s), {
      connected_above: this.connected_above && !this.border_highlighted,
    });
  }

  /**
   * 是否正在显示自动完成或仍有未完成的补全请求。
   */
  private has_autocomplete_activity(): boolean {
    const autocomplete = this as unknown as AutocompleteInternals;
    return (
      this.isShowingAutocomplete() ||
      autocomplete.autocompleteAbort !== undefined ||
      autocomplete.autocompleteDebounceTimer !== undefined
    );
  }

  private cancel_autocomplete_activity(): void {
    (this as unknown as AutocompleteInternals).cancelAutocomplete();
  }

  /**
   * 如果光标位于 paste marker 上，将其展开为实际内容。
   */
  private expand_paste_marker_at_cursor(): boolean {
    const { line, col } = this.getCursor();
    const lines = this.getLines();
    const current_line = lines[line] ?? "";

    for (const match of current_line.matchAll(PASTE_MARKER_RE)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      if (col < start || col > end) continue;

      const paste_id = Number(match[1]);
      const pastes = (this as unknown as { pastes: Map<number, string> }).pastes;
      const content = pastes.get(paste_id);
      if (content === undefined) return false;

      const text = this.getText();
      const offset = lines.slice(0, line).reduce((sum, l) => sum + l.length + 1, 0) + start;
      const new_text = text.slice(0, offset) + content + text.slice(offset + match[0].length);
      this.setText(new_text);
      return true;
    }
    return false;
  }
}

/**
 * 处理 caps-lock 开启时 Kitty 键盘协议下 ctrl+字母的序列异常。
 */
function normalize_caps_locked_ctrl(data: string): string {
  const match = data.match(KITTY_CSI_U);
  if (match === null) {
    return data;
  }
  const codepoint = Number(match[1]);
  const modifier_plus_1 = Number(match[2]);
  const tail = match[3] ?? "";
  if (!Number.isFinite(codepoint) || !Number.isFinite(modifier_plus_1)) {
    return data;
  }
  const modifier = modifier_plus_1 - 1;
  if ((modifier & CAPS_LOCK_BIT) === 0) {
    return data;
  }
  if ((modifier & CTRL_BIT) === 0) {
    return data;
  }
  if ((modifier & SHIFT_BIT) !== 0) {
    return data;
  }
  if (codepoint < 65 || codepoint > 90) {
    return data;
  }
  const lowered_codepoint = codepoint + 32;
  const stripped_modifier = (modifier & ~CAPS_LOCK_BIT) + 1;
  return "\u001B[" + String(lowered_codepoint) + ";" + String(stripped_modifier) + tail + "u";
}

function get_newline_input(data: string): string | undefined {
  if (data === "\n" || data === "\u001B\r" || data === "\u001B[13;2~") {
    return data;
  }
  if (matchesKey(data, Key.ctrl("j"))) {
    return "\n";
  }
  return undefined;
}

/**
 * 将可见字符索引映射回带 ANSI 转义字符串中的原始索引。
 */
function map_visible_idx_to_raw(line: string, visible_idx: number): number {
  let visible_count = 0;
  let i = 0;
  const re = new RegExp(ANSI_SGR.source, "y");
  while (i < line.length && visible_count < visible_idx) {
    re.lastIndex = i;
    const match = re.exec(line);
    if (match !== null && match.index === i) {
      i += match[0].length;
    } else {
      visible_count += 1;
      i += 1;
    }
  }
  return i;
}

function strip_sgr(s: string): string {
  return s.replace(ANSI_SGR, "");
}

/**
 * 高亮第一行里的 /token。
 */
function highlight_first_slash_token(line: string): string | undefined {
  const visible = strip_sgr(line);
  const slash_index = visible.indexOf("/");
  if (slash_index < 0) {
    return undefined;
  }
  for (let i = 0; i < slash_index; i += 1) {
    const ch = visible[i];
    if (ch !== " " && ch !== "\t") {
      return undefined;
    }
  }
  let end_visible = slash_index + 1;
  while (end_visible < visible.length) {
    const ch = visible[end_visible];
    if (ch === " " || ch === "\t") {
      break;
    }
    end_visible += 1;
  }
  const token = visible.slice(slash_index, end_visible);
  if (token.slice(1).includes("/")) {
    return undefined;
  }
  const ranges = [{ start: slash_index, end: end_visible }];
  if (token === "/goal") {
    ranges.push(...goal_command_path_ranges(visible, end_visible));
  }
  return highlight_visible_ranges(line, ranges);
}

function goal_command_path_ranges(
  visible: string,
  command_end: number,
): Array<{ start: number; end: number }> {
  const next_range = read_token_range(visible, command_end);
  if (next_range === null || visible.slice(next_range.start, next_range.end) !== "next") {
    return [];
  }
  const ranges = [next_range];
  const manage_range = read_token_range(visible, next_range.end);
  if (
    manage_range !== null &&
    visible.slice(manage_range.start, manage_range.end) === "manage"
  ) {
    ranges.push(manage_range);
  }
  return ranges;
}

function read_token_range(
  visible: string,
  start: number,
): { start: number; end: number } | null {
  let token_start = start;
  while (token_start < visible.length && is_token_space(visible[token_start])) token_start += 1;
  if (token_start >= visible.length) return null;
  let token_end = token_start;
  while (token_end < visible.length && !is_token_space(visible[token_end])) token_end += 1;
  return { start: token_start, end: token_end };
}

function is_token_space(ch: string | undefined): boolean {
  return ch === " " || ch === "\t";
}

function highlight_visible_ranges(
  line: string,
  ranges: Array<{ start: number; end: number }>,
): string {
  let out = "";
  let raw_cursor = 0;
  for (const range of ranges) {
    const raw_start = map_visible_idx_to_raw(line, range.start);
    const raw_end = map_visible_idx_to_raw(line, range.end);
    out += line.slice(raw_cursor, raw_start);
    out += current_theme.bold_fg("primary", line.slice(raw_start, raw_end));
    raw_cursor = raw_end;
  }
  return out + line.slice(raw_cursor);
}

/**
 * 在第一行内容前注入 > prompt 符号。
 *
 * 与 paddingX=3 配合：前 3 列空白替换为 "> "（长度 2），
 * 保留 2 列有效内部前缀（符号 + 后置空格），与续行的 2 列空白前缀对齐。
 * 最终呈现 "│> hello"，prompt 紧贴左边框后第一列。
 */
function inject_prompt_symbol(line: string): string | undefined {
  if (line.length < 3) {
    return undefined;
  }
  for (let i = 0; i < 3; i += 1) {
    if (line[i] !== " ") {
      return undefined;
    }
  }
  return "> " + line.slice(3);
}

interface WrapBorderOptions {
  connected_above?: boolean;
}

/**
 * 为 pi-tui Editor 的渲染结果补全四角和侧边框。
 *
 * 关键点（中文）
 * - 判断行首/行尾是否为空格时基于 strip_sgr 后的可见字符，避免 slash 高亮、
 *   光标反色等 ANSI 转义导致边框缺角。
 */
function wrap_with_side_borders(
  lines: string[],
  paint: (s: string) => string,
  options: WrapBorderOptions = {},
): string[] {
  let seen_top = false;
  return lines.map((line) => {
    const plain = strip_sgr(line);
    if (plain.length > 0 && plain[0] === "─") {
      const left_corner = seen_top
        ? "╰"
        : options.connected_above === true
          ? "├"
          : "╭";
      const right_corner = seen_top
        ? "╯"
        : options.connected_above === true
          ? "┤"
          : "╮";
      seen_top = true;
      if (plain.length === 1) {
        return paint(left_corner);
      }
      const middle = plain.slice(1, -1);
      return paint(left_corner + middle + right_corner);
    }
    if (plain.length === 0) {
      return line;
    }
    const first_plain = plain[0];
    const last_plain = plain.at(-1);
    // prompt 符号 ">" 应紧贴左边框：将左侧边框画在 ">" 之前。
    const head =
      first_plain === " "
        ? paint("│")
        : first_plain === ">"
          ? paint("│") + (line[0] ?? "")
          : (line[0] ?? "");
    const tail = line.length > 1 && last_plain === " " ? paint("│") : (line.at(-1) ?? "");
    if (line.length === 1) {
      return head;
    }
    return head + line.slice(1, -1) + tail;
  });
}
