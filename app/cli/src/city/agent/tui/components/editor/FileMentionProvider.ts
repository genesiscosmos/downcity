/**
 * 输入框自动完成提供器。
 *
 * 关键点（中文）
 * - 完全对齐 Kimi Code 的 file-mention-provider：
 *   1. slash 命令名补全自己处理，支持主名 + 别名模糊匹配，别名命中时在 label 中展示来源。
 *   2. `@` 文件/目录 mention 优先走 pi-tui 的 fd 后端；fd 不可用时回退到文件系统扫描。
 *   3. 普通路径补全仍交给 pi-tui 的 CombinedAutocompleteProvider。
 * - 额外保留 Kimi 的 slash 守卫：行首带空白的 `/path` 不补全、slash 命令参数后不再触发路径补全。
 */

import { readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";

import {
  CombinedAutocompleteProvider,
  fuzzyMatch,
  type AutocompleteItem,
  type AutocompleteProvider,
  type AutocompleteSuggestions,
  type SlashCommand as PiSlashCommand,
} from "@earendil-works/pi-tui";

import type { SlashCommand } from "@/city/agent/tui/commands/types.js";

/** mention token 的分隔符集合：遇到这些字符即认为是新 token 的起点。 */
const PATH_DELIMITERS = new Set([" ", "\t", '"', "'", "="]);
/** 文件系统回退扫描的最大候选数量上限。 */
const MAX_FALLBACK_SCAN = 2000;
/** 文件系统回退最终返回的最大候选数量上限。 */
const MAX_FALLBACK_SUGGESTIONS = 50;

/** 文件系统 mention 候选项。 */
interface FsMentionCandidate {
  /** 相对于工作目录的路径。 */
  readonly path: string;
  /** 是否为目录。 */
  readonly is_directory: boolean;
}

/** slash 命令模糊匹配结果。 */
interface SlashCommandMatch {
  /** 命中的命令。 */
  readonly command: SlashCommand;
  /** 模糊匹配得分（越小越靠前）。 */
  readonly score: number;
  /** 是否通过别名命中。 */
  readonly via_alias: boolean;
  /** 自动完成面板展示的 label。 */
  readonly label: string;
}

/**
 * 输入框自动完成提供器。
 */
export class FileMentionProvider implements AutocompleteProvider {
  /** 内部包装的 pi-tui 组合补全提供器。 */
  private readonly inner: CombinedAutocompleteProvider;

  /**
   * @param slash_commands 内置 slash 命令列表。
   * @param work_dir 文件补全的基准工作目录。
   * @param fd_path fd 可执行文件路径；为 null 时使用文件系统回退。
   */
  constructor(
    private readonly slash_commands: readonly SlashCommand[],
    private readonly work_dir: string,
    private readonly fd_path: string | null = null,
  ) {
    // 构造展开后的命令列表（含别名条目），让 inner 的参数补全也能按别名找到命令。
    const expanded: PiSlashCommand[] = [];
    for (const cmd of slash_commands) {
      expanded.push(to_pi_slash_command(cmd, cmd.name));
      for (const alias of cmd.aliases) {
        expanded.push(to_pi_slash_command(cmd, alias));
      }
    }
    this.inner = new CombinedAutocompleteProvider(expanded, work_dir, fd_path);
  }

  /**
   * 获取自动完成建议。
   */
  async getSuggestions(
    lines: string[],
    cursor_line: number,
    cursor_col: number,
    options: { signal: AbortSignal; force?: boolean },
  ): Promise<AutocompleteSuggestions | null> {
    const current_line = lines[cursor_line] ?? "";
    const text_before_cursor = current_line.slice(0, cursor_col);

    if (should_suppress_leading_whitespace_slash_path(text_before_cursor, options.force)) {
      return null;
    }

    if (
      should_suppress_slash_argument_completion(
        text_before_cursor,
        current_line.slice(cursor_col),
        options.force,
      )
    ) {
      return null;
    }

    const at_prefix = extract_at_prefix(text_before_cursor);
    if (at_prefix !== null) {
      if (this.fd_path === null) {
        return get_fs_mention_suggestions(this.work_dir, at_prefix, options.signal);
      }
      try {
        return await this.inner.getSuggestions(lines, cursor_line, cursor_col, options);
      } catch {
        // fd 意外失败时，保持 @ 补全可用。
        return get_fs_mention_suggestions(this.work_dir, at_prefix, options.signal);
      }
    }

    // slash 命令名补全自己处理，让别名可搜索且在 label 中可见。
    if (options.force !== true && text_before_cursor.startsWith("/")) {
      const space_index = text_before_cursor.indexOf(" ");
      if (space_index === -1) {
        const tokens = text_before_cursor
          .slice(1)
          .trim()
          .split(/\s+/)
          .filter((t) => t.length > 0);

        const matches = this.match_slash_commands(tokens);
        if (matches.length === 0) {
          return null;
        }
        return {
          items: matches.map((m) => ({
            value: m.command.name,
            label: m.label,
            description: format_slash_command_description(m.command),
          })),
          prefix: text_before_cursor,
        };
      }
    }

    try {
      return await this.inner.getSuggestions(lines, cursor_line, cursor_col, options);
    } catch {
      return null;
    }
  }

  /**
   * 应用选中的自动完成项。
   */
  applyCompletion(
    lines: string[],
    cursor_line: number,
    cursor_col: number,
    item: AutocompleteItem,
    prefix: string,
  ): { lines: string[]; cursorLine: number; cursorCol: number } {
    return this.inner.applyCompletion(lines, cursor_line, cursor_col, item, prefix);
  }

  /**
   * 按主名 + 别名对 slash 命令做模糊匹配并排序。
   *
   * 主名命中优先于别名命中（同分时主名靠前）。
   */
  private match_slash_commands(tokens: readonly string[]): SlashCommandMatch[] {
    const matches: SlashCommandMatch[] = [];
    for (const command of this.slash_commands) {
      const name_score = score_tokens(tokens, command.name);
      if (name_score !== null) {
        matches.push({ command, score: name_score, via_alias: false, label: command.name });
        continue;
      }
      // 别名只在主名未命中时计入，命中后在 label 中列出来源。
      let best_alias_score: number | null = null;
      for (const alias of command.aliases) {
        const alias_score = score_tokens(tokens, alias);
        if (alias_score !== null && (best_alias_score === null || alias_score < best_alias_score)) {
          best_alias_score = alias_score;
        }
      }
      if (best_alias_score !== null) {
        matches.push({
          command,
          score: best_alias_score,
          via_alias: true,
          label: `${command.name} (${command.aliases.join(", ")})`,
        });
      }
    }
    matches.sort((a, b) => a.score - b.score || Number(a.via_alias) - Number(b.via_alias));
    return matches;
  }
}

/**
 * 将 downcity 的 SlashCommand 适配为 pi-tui 的 SlashCommand。
 *
 * @param command 源命令。
 * @param name 用于该条目的名称（主名或别名）。
 */
function to_pi_slash_command(command: SlashCommand, name: string): PiSlashCommand {
  return {
    name,
    description: command.description,
    getArgumentCompletions: command.get_argument_completions
      ? (argument_prefix: string) => command.get_argument_completions?.(argument_prefix) ?? null
      : undefined,
  };
}

/**
 * 从光标前文本中提取 `@` mention 前缀。
 *
 * @returns 形如 `@src/foo` 的前缀；当前 token 不以 `@` 开头时返回 null。
 */
function extract_at_prefix(text: string): string | null {
  let token_start = 0;
  for (let i = text.length - 1; i >= 0; i -= 1) {
    if (PATH_DELIMITERS.has(text[i] ?? "")) {
      token_start = i + 1;
      break;
    }
  }
  if (text[token_start] !== "@") {
    return null;
  }
  return text.slice(token_start);
}

/**
 * 文件系统回退：扫描工作目录并返回 `@` mention 候选项。
 */
function get_fs_mention_suggestions(
  work_dir: string,
  at_prefix: string,
  signal: AbortSignal,
): AutocompleteSuggestions | null {
  if (signal.aborted) {
    return null;
  }

  const query = at_prefix.slice(1);
  const candidates = collect_fs_mention_candidates(work_dir, signal);
  if (candidates.length === 0 || signal.aborted) {
    return null;
  }

  const ranked = rank_fs_mention_candidates(candidates, query).slice(0, MAX_FALLBACK_SUGGESTIONS);
  if (ranked.length === 0) {
    return null;
  }

  return {
    prefix: at_prefix,
    items: ranked.map(to_mention_item),
  };
}

/**
 * 广度优先扫描工作目录，收集文件/目录候选项。
 */
function collect_fs_mention_candidates(
  work_dir: string,
  signal: AbortSignal,
): FsMentionCandidate[] {
  const result: FsMentionCandidate[] = [];
  const stack = [""];

  while (stack.length > 0 && result.length < MAX_FALLBACK_SCAN) {
    if (signal.aborted) {
      break;
    }
    const relative_dir = stack.pop() ?? "";
    const absolute_dir = relative_dir.length === 0 ? work_dir : join(work_dir, relative_dir);
    let entries;
    try {
      entries = readdirSync(absolute_dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (signal.aborted || result.length >= MAX_FALLBACK_SCAN) {
        break;
      }
      if (entry.name === ".git") {
        continue;
      }

      const relative_path = normalize_path(
        relative_dir.length === 0 ? entry.name : join(relative_dir, entry.name),
      );
      const is_symlink = entry.isSymbolicLink();
      let is_directory = entry.isDirectory();
      if (!is_directory && is_symlink) {
        try {
          is_directory = statSync(join(work_dir, relative_path)).isDirectory();
        } catch {
          // 断链或权限错误：保留为文件候选项。
        }
      }

      result.push({ path: relative_path, is_directory });
      if (is_directory && !is_symlink) {
        stack.push(relative_path);
      }
    }
  }

  return result;
}

/**
 * 按 query 对候选项打分并排序。
 */
function rank_fs_mention_candidates(
  candidates: readonly FsMentionCandidate[],
  query: string,
): FsMentionCandidate[] {
  const lower_query = query.toLowerCase();
  const scored: Array<{ candidate: FsMentionCandidate; score: number }> = [];

  for (const candidate of candidates) {
    const score = score_candidate(candidate, lower_query);
    if (score > 0) {
      scored.push({ candidate, score });
    }
  }

  scored.sort((a, b) => {
    if (a.score !== b.score) {
      return b.score - a.score;
    }
    if (a.candidate.is_directory !== b.candidate.is_directory) {
      return a.candidate.is_directory ? -1 : 1;
    }
    return a.candidate.path.localeCompare(b.candidate.path);
  });

  return scored.map((entry) => entry.candidate);
}

/**
 * 对单个候选项打分。
 */
function score_candidate(candidate: FsMentionCandidate, lower_query: string): number {
  if (lower_query.length === 0) {
    const depth_penalty = candidate.path.split("/").length - 1;
    return (candidate.is_directory ? 120 : 100) - depth_penalty;
  }

  const lower_path = candidate.path.toLowerCase();
  const lower_base = basename(candidate.path).toLowerCase();
  let score = 0;
  if (lower_base === lower_query) {
    score = 100;
  } else if (lower_base.startsWith(lower_query)) {
    score = 80;
  } else if (lower_base.includes(lower_query)) {
    score = 50;
  } else if (lower_path.includes(lower_query)) {
    score = 30;
  }
  if (candidate.is_directory && score > 0) {
    score += 10;
  }
  return score;
}

/**
 * 将候选项转换为自动完成项。
 */
function to_mention_item(candidate: FsMentionCandidate): AutocompleteItem {
  const value_path = candidate.is_directory ? `${candidate.path}/` : candidate.path;
  const value = value_path.includes(" ") ? `@"${value_path}"` : `@${value_path}`;
  const label = `${basename(candidate.path)}${candidate.is_directory ? "/" : ""}`;
  return {
    value,
    label,
    description: value_path,
  };
}

/**
 * 将路径分隔符统一为 `/`。
 */
function normalize_path(path: string): string {
  return path.replaceAll("\\", "/");
}

/**
 * 行首带空白的 `/path` 不应触发 slash 路径补全。
 */
function should_suppress_leading_whitespace_slash_path(
  text_before_cursor: string,
  force: boolean | undefined,
): boolean {
  if (force === true) {
    return false;
  }
  if (text_before_cursor.startsWith("/")) {
    return false;
  }
  return text_before_cursor.trimStart().startsWith("/");
}

/**
 * slash 命令参数已输入且光标后仍有内容时，不再触发路径补全。
 */
function should_suppress_slash_argument_completion(
  text_before_cursor: string,
  text_after_cursor: string,
  force: boolean | undefined,
): boolean {
  if (force === true) {
    return false;
  }
  if (!text_before_cursor.startsWith("/")) {
    return false;
  }
  if (!text_before_cursor.includes(" ")) {
    return false;
  }
  return text_after_cursor.trimStart().length > 0;
}

/**
 * 所有 token 必须模糊命中 text，返回累加得分；任一 token 未命中返回 null。
 * 空 token 列表以得分 0 命中一切。语义对齐 pi-tui 的 fuzzyFilter。
 */
function score_tokens(tokens: readonly string[], text: string): number | null {
  let score = 0;
  for (const token of tokens) {
    const m = fuzzyMatch(token, text);
    if (!m.matches) {
      return null;
    }
    score += m.score;
  }
  return score;
}

/**
 * 还原 slash 命令描述渲染：保留 argumentHint 与描述的拼接。
 * downcity 的 SlashCommand 暂无 argumentHint，直接返回描述。
 */
function format_slash_command_description(command: SlashCommand): string | undefined {
  return command.description || undefined;
}
