/**
 * Shell action 返回结构辅助。
 *
 * 关键点（中文）
 * - 集中处理输出游标、token 近似裁剪与标准 action response。
 * - 这里不读取文件、不修改 session，只基于传入文本构造返回对象。
 */

import type { ShellHostContext } from "@/shell/types/ShellHostContext.js";
import type {
  ShellActionResponse,
  ShellOutputChunk,
  ShellSessionSnapshot,
} from "@/shell/types/ShellAction.js";

const DEFAULT_MAX_OUTPUT_CHARS = 12_000;
const DEFAULT_MAX_OUTPUT_LINES = 200;
const APPROX_CHARS_PER_TOKEN = 4;

function resolveOutputLimits(params: {
  context: ShellHostContext;
  maxOutputTokens?: number;
}): {
  maxChars: number;
  maxLines: number;
} {
  const byTokens =
    typeof params.maxOutputTokens === "number" &&
    Number.isFinite(params.maxOutputTokens) &&
    params.maxOutputTokens > 0
      ? Math.max(200, Math.floor(params.maxOutputTokens * APPROX_CHARS_PER_TOKEN))
      : null;
  return {
    maxChars:
      byTokens == null
        ? DEFAULT_MAX_OUTPUT_CHARS
        : Math.min(DEFAULT_MAX_OUTPUT_CHARS, byTokens),
    maxLines: DEFAULT_MAX_OUTPUT_LINES,
  };
}

function splitOutputByLimits(
  text: string,
  maxChars: number,
  maxLines: number,
): { head: string; tail: string } {
  const limitedByChars = text.slice(0, Math.min(text.length, maxChars));
  let head = limitedByChars;
  if (maxLines > 0) {
    const lines = limitedByChars.split("\n");
    if (lines.length > maxLines) {
      head = lines.slice(0, maxLines).join("\n");
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
export function createOutputChunk(params: {
  /**
   * 当前 shell session 标识。
   */
  shellId: string;
  /**
   * 当前完整输出文本。
   */
  outputText: string;
  /**
   * 本次读取起始游标。
   */
  fromCursor?: number;
  /**
   * 当前 Agent 执行上下文。
   */
  context: ShellHostContext;
  /**
   * 输出 token 近似上限。
   */
  maxOutputTokens?: number;
}): ShellOutputChunk {
  const fromCursor =
    typeof params.fromCursor === "number" && params.fromCursor >= 0
      ? Math.floor(params.fromCursor)
      : 0;
  const available = params.outputText.slice(fromCursor);
  const originalChars = available.length;
  const originalLines = available ? available.split("\n").length : 0;
  const limits = resolveOutputLimits({
    context: params.context,
    maxOutputTokens: params.maxOutputTokens,
  });
  const { head, tail } = splitOutputByLimits(
    available,
    limits.maxChars,
    limits.maxLines,
  );
  return {
    shellId: params.shellId,
    output: head,
    startCursor: fromCursor,
    endCursor: fromCursor + head.length,
    originalChars,
    originalLines,
    hasMoreOutput: tail.length > 0,
  };
}

/**
 * 构造 shell action 标准返回。
 */
export function buildActionResponse(params: {
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
