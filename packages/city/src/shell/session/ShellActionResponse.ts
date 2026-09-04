/**
 * Shell action 返回结构辅助。
 *
 * 关键点（中文）
 * - 集中处理输出游标、token 近似裁剪与标准 action response。
 * - 这里不读取文件、不修改 session，只基于传入文本构造返回对象。
 */

import type { ShellHostContext } from "@downcity/type/shell";
import type {
  ShellActionResponse,
  ShellOutputChunk,
  ShellSessionSnapshot,
} from "@downcity/type/shell";

const DEFAULT_MAX_OUTPUT_CHARS = 12_000;
const DEFAULT_MAX_OUTPUT_LINES = 200;
const APPROX_CHARS_PER_TOKEN = 4;

function resolve_output_limits(params: {
  context: ShellHostContext;
  max_output_tokens?: number;
}): {
  max_chars: number;
  max_lines: number;
} {
  const by_tokens =
    typeof params.max_output_tokens === "number" &&
    Number.isFinite(params.max_output_tokens) &&
    params.max_output_tokens > 0
      ? Math.max(200, Math.floor(params.max_output_tokens * APPROX_CHARS_PER_TOKEN))
      : null;
  return {
    max_chars:
      by_tokens == null
        ? DEFAULT_MAX_OUTPUT_CHARS
        : Math.min(DEFAULT_MAX_OUTPUT_CHARS, by_tokens),
    max_lines: DEFAULT_MAX_OUTPUT_LINES,
  };
}

function split_output_by_limits(
  text: string,
  max_chars: number,
  max_lines: number,
): { head: string; tail: string } {
  const limited_by_chars = text.slice(0, Math.min(text.length, max_chars));
  let head = limited_by_chars;
  if (max_lines > 0) {
    const lines = limited_by_chars.split("\n");
    if (lines.length > max_lines) {
      head = lines.slice(0, max_lines).join("\n");
    }
  }
  return {
    head,
    tail: text.slice(head.length),
  };
}

/**
 * 根据游标与 token 限制构造输出块。
 */
export function create_output_chunk(params: {
  /**
   * 当前 shell session 标识。
   */
  shell_id: string;
  /**
   * 当前完整输出文本。
   */
  output_text: string;
  /**
   * 本次读取起始游标。
   */
  from_cursor?: number;
  /**
   * 当前 Agent 执行上下文。
   */
  context: ShellHostContext;
  /**
   * 输出 token 近似上限。
   */
  max_output_tokens?: number;
}): ShellOutputChunk {
  const from_cursor =
    typeof params.from_cursor === "number" && params.from_cursor >= 0
      ? Math.floor(params.from_cursor)
      : 0;
  const available = params.output_text.slice(from_cursor);
  const original_chars = available.length;
  const original_lines = available ? available.split("\n").length : 0;
  const limits = resolve_output_limits({
    context: params.context,
    max_output_tokens: params.max_output_tokens,
  });
  const { head, tail } = split_output_by_limits(
    available,
    limits.max_chars,
    limits.max_lines,
  );
  return {
    shell_id: params.shell_id,
    output: head,
    start_cursor: from_cursor,
    end_cursor: from_cursor + head.length,
    original_chars,
    original_lines,
    has_more_output: tail.length > 0,
  };
}

/**
 * 构造 shell action 标准返回。
 */
export function build_action_response(params: {
  /**
   * 当前 shell 快照。
   */
  shell: ShellSessionSnapshot;
  /**
   * 可选输出块。
   */
  chunk?: ShellOutputChunk;
  /**
   * 可选人类可读提示。
   */
  note?: string;
}): ShellActionResponse {
  return {
    shell: params.shell,
    ...(params.chunk ? { chunk: params.chunk } : {}),
    ...(params.note ? { note: params.note } : {}),
  };
}
