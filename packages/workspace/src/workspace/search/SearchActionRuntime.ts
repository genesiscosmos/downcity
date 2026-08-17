/**
 * 项目搜索 action 运行时。
 *
 * 关键点（中文）
 * - `grep` 通过参数数组执行 `rg --json`，不会把模型输入拼接进 shell 命令。
 * - `find` 通过 globby 流式发现文件，尊重 `.gitignore` 且不跟随符号链接。
 * - 两个 action 都复用项目根目录约束，并在结果达到上限后尽快停止扫描。
 */

import { spawn } from "node:child_process";
import { lstat } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import type { Readable } from "node:stream";
import globby from "globby";
import type {
  FindToolInput,
  FindToolResult,
  GrepToolInput,
  GrepToolMatch,
  GrepToolResult,
  SearchToolActionRequest,
  SearchToolActionResult,
} from "@/types/workspace/SearchTool.js";
import { resolve_search_tool_path } from "@/workspace/file/FilePathPolicy.js";
import {
  SearchToolRuntimeError,
  to_search_tool_failure,
} from "@/workspace/search/SearchToolError.js";

const DEFAULT_MAX_RESULTS = 200;
const MAX_RESULTS = 2_000;
const MAX_LINE_PREVIEW_CHARS = 2_000;
const MAX_STDERR_CHARS = 16_000;

/** ripgrep JSON 字符串字段。 */
interface RipgrepJsonText {
  /** UTF-8 可解码时的原始文本。 */
  text?: string;
  /** 无法直接表示为 UTF-8 时的 base64 数据。 */
  bytes?: string;
}

/** ripgrep JSON 子匹配。 */
interface RipgrepJsonSubmatch {
  /** 当前子匹配文本。 */
  match?: RipgrepJsonText;
  /** 当前子匹配在行内的 0-based UTF-8 字节起点。 */
  start?: number;
}

/** ripgrep JSON 事件。 */
interface RipgrepJsonEvent {
  /** 事件类型。 */
  type?: string;
  /** begin / match 事件数据。 */
  data?: {
    /** 当前文件路径。 */
    path?: RipgrepJsonText;
    /** 当前匹配行文本。 */
    lines?: RipgrepJsonText;
    /** 当前匹配的 1-based 行号。 */
    line_number?: number;
    /** 当前行内的子匹配列表。 */
    submatches?: RipgrepJsonSubmatch[];
  };
}

/** 把结果上限归一化到公共协议允许范围。 */
function resolve_max_results(value: number | undefined): number {
  return Math.min(
    MAX_RESULTS,
    Math.max(1, Math.floor(value ?? DEFAULT_MAX_RESULTS)),
  );
}

/** 把任意平台路径转换为稳定的 POSIX 路径。 */
function to_posix_path(file_path: string): string {
  return file_path.split(path.sep).join(path.posix.sep);
}

/** 解码 ripgrep JSON 中的 text / bytes 判别字段。 */
function decode_rg_text(value: RipgrepJsonText | undefined): string {
  if (typeof value?.text === "string") return value.text;
  if (typeof value?.bytes === "string") {
    return Buffer.from(value.bytes, "base64").toString("utf8");
  }
  return "";
}

/** 去除 ripgrep 行文本末尾的单个换行符。 */
function trim_line_ending(content: string): string {
  if (content.endsWith("\r\n")) return content.slice(0, -2);
  if (content.endsWith("\n") || content.endsWith("\r")) {
    return content.slice(0, -1);
  }
  return content;
}

/** 构造模型可读、长度稳定的行预览。 */
function create_line_preview(content: string): {
  /** 截断后的行文本。 */
  text: string;
  /** 原始行是否被截断。 */
  line_truncated: boolean;
} {
  const line = trim_line_ending(content);
  const line_truncated = line.length > MAX_LINE_PREVIEW_CHARS;
  return {
    text: line_truncated ? line.slice(0, MAX_LINE_PREVIEW_CHARS) : line,
    line_truncated,
  };
}

/** 校验并归一化 find 使用的 glob 模式。 */
function resolve_find_pattern(raw_pattern: string): string {
  const pattern = String(raw_pattern || "").trim();
  if (
    !pattern ||
    pattern.includes("\0") ||
    pattern.includes("\\") ||
    path.posix.isAbsolute(pattern) ||
    /^[a-zA-Z]:\//.test(pattern) ||
    pattern.startsWith("!")
  ) {
    throw new SearchToolRuntimeError({
      error_code: "invalid_pattern",
      message: "pattern must be a non-empty positive POSIX glob relative to the search path",
    });
  }
  const has_parent_segment = pattern
    .split("/")
    .some((segment) => segment === ".." || /(^|[({,|@+*?!])\.\.($|[)},|])/.test(segment));
  if (has_parent_segment) {
    throw new SearchToolRuntimeError({
      error_code: "invalid_pattern",
      message: "pattern must not contain parent-directory segments",
    });
  }
  return pattern;
}

/** 把 ripgrep 输出路径归一化为项目相对路径。 */
function resolve_rg_file_path(root_path: string, output_path: string): string {
  const absolute_path = path.isAbsolute(output_path)
    ? path.resolve(output_path)
    : path.resolve(root_path, output_path);
  return to_posix_path(path.relative(root_path, absolute_path));
}

/** 执行 ripgrep 内容搜索。 */
async function grep_action(
  context: { readonly rootPath: string },
  input: GrepToolInput,
  abort_signal?: AbortSignal,
): Promise<GrepToolResult> {
  let search_path = "";
  try {
    const query = String(input.query || "");
    if (!query || query.includes("\0")) {
      throw new SearchToolRuntimeError({
        error_code: "invalid_pattern",
        message: "query must be a non-empty valid string",
      });
    }
    if (abort_signal?.aborted) {
      throw new SearchToolRuntimeError({
        error_code: "aborted",
        message: "grep search was aborted before it started",
      });
    }
    const resolved = await resolve_search_tool_path({
      root_path: context.rootPath,
      file_path: input.path || ".",
    });
    search_path = resolved.file_path;
    const root_path = resolved.root_path;
    const max_results = resolve_max_results(input.max_results);
    const target_path = to_posix_path(path.relative(root_path, search_path)) || ".";
    const args = [
      "--json",
      "--hidden",
      "--no-require-git",
      "--glob",
      "!.git/**",
      ...(input.case_sensitive === true ? [] : ["--ignore-case"]),
      ...(input.literal === false ? [] : ["--fixed-strings"]),
      ...((input.glob || []).flatMap((pattern) => ["--glob", pattern])),
      "--",
      query,
      target_path,
    ];
    const child = spawn("rg", args, {
      cwd: root_path,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const matches: GrepToolMatch[] = [];
    let files_searched = 0;
    let truncated = false;
    let stderr = "";
    let aborted = false;

    const abort_handler = (): void => {
      aborted = true;
      child.kill("SIGTERM");
    };
    abort_signal?.addEventListener("abort", abort_handler, { once: true });

    const completion = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code, signal) => resolve({ code, signal }));
      },
    );
    const stderr_task = (async (): Promise<void> => {
      child.stderr.setEncoding("utf8");
      for await (const chunk of child.stderr) {
        if (stderr.length >= MAX_STDERR_CHARS) continue;
        stderr += String(chunk).slice(0, MAX_STDERR_CHARS - stderr.length);
      }
    })();
    const stdout_task = (async (): Promise<void> => {
      const lines = readline.createInterface({ input: child.stdout });
      for await (const raw_line of lines) {
        if (!raw_line) continue;
        let event: RipgrepJsonEvent;
        try {
          event = JSON.parse(raw_line) as RipgrepJsonEvent;
        } catch {
          child.kill("SIGTERM");
          throw new SearchToolRuntimeError({
            error_code: "search_failed",
            message: "ripgrep returned malformed JSON output",
            search_path,
          });
        }
        if (event.type === "begin") {
          files_searched += 1;
          continue;
        }
        if (event.type !== "match" || !event.data) continue;
        const output_path = decode_rg_text(event.data.path);
        const line_number = Number(event.data.line_number || 0);
        const preview = create_line_preview(decode_rg_text(event.data.lines));
        for (const submatch of event.data.submatches || []) {
          if (matches.length >= max_results) {
            truncated = true;
            child.kill("SIGTERM");
            return;
          }
          matches.push({
            file_path: resolve_rg_file_path(root_path, output_path),
            line_number,
            column: Number(submatch.start || 0) + 1,
            text: preview.text,
            match_text: decode_rg_text(submatch.match),
            line_truncated: preview.line_truncated,
          });
        }
      }
    })();

    let process_result: { code: number | null; signal: NodeJS.Signals | null };
    try {
      [, , process_result] = await Promise.all([
        stdout_task,
        stderr_task,
        completion,
      ]);
    } finally {
      abort_signal?.removeEventListener("abort", abort_handler);
    }
    if (aborted) {
      throw new SearchToolRuntimeError({
        error_code: "aborted",
        message: "grep search was aborted",
        search_path,
      });
    }
    if (!truncated && process_result.code !== 0 && process_result.code !== 1) {
      const message = stderr.trim() || `ripgrep exited with code ${String(process_result.code)}`;
      throw new SearchToolRuntimeError({
        error_code: input.literal === false && /regex parse error|error parsing regex/i.test(message)
          ? "invalid_pattern"
          : "search_failed",
        message,
        search_path,
      });
    }
    return {
      success: true,
      root_path,
      search_path,
      query,
      matches,
      files_searched,
      match_count: matches.length,
      truncated,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        success: false,
        error_code: "rg_unavailable",
        message: "ripgrep executable 'rg' was not found in PATH",
        ...(search_path ? { search_path } : {}),
      };
    }
    return to_search_tool_failure(error, search_path || undefined);
  }
}

/** 执行 glob 文件发现。 */
async function find_action(
  context: { readonly rootPath: string },
  input: FindToolInput,
  abort_signal?: AbortSignal,
): Promise<FindToolResult> {
  let search_path = "";
  try {
    const pattern = resolve_find_pattern(input.pattern);
    if (abort_signal?.aborted) {
      throw new SearchToolRuntimeError({
        error_code: "aborted",
        message: "find search was aborted before it started",
      });
    }
    const resolved = await resolve_search_tool_path({
      root_path: context.rootPath,
      file_path: input.path || ".",
    });
    search_path = resolved.file_path;
    const metadata = await lstat(search_path);
    if (!metadata.isDirectory()) {
      throw new SearchToolRuntimeError({
        error_code: "not_a_directory",
        message: `find path must be a directory: ${search_path}`,
        search_path,
      });
    }
    const max_results = resolve_max_results(input.max_results);
    const search_prefix = to_posix_path(
      path.relative(resolved.root_path, search_path),
    );
    const scoped_pattern = search_prefix
      ? path.posix.join(search_prefix, pattern)
      : pattern;
    const stream = globby.stream(scoped_pattern, {
      cwd: resolved.root_path,
      gitignore: true,
      dot: true,
      onlyFiles: true,
      followSymbolicLinks: false,
      unique: true,
      expandDirectories: false,
      ignore: [".git/**"],
    }) as Readable & AsyncIterable<string | Buffer>;
    let aborted = false;
    const abort_handler = (): void => {
      aborted = true;
      stream.destroy();
    };
    abort_signal?.addEventListener("abort", abort_handler, { once: true });
    const files: string[] = [];
    let truncated = false;
    try {
      for await (const entry of stream) {
        if (aborted) break;
        if (files.length >= max_results) {
          truncated = true;
          break;
        }
        const relative_to_root_entry = String(entry);
        const absolute_path = path.resolve(
          resolved.root_path,
          relative_to_root_entry,
        );
        const relative_to_search = path.relative(search_path, absolute_path);
        const relative_to_root = path.relative(resolved.root_path, absolute_path);
        if (
          relative_to_search === ".." ||
          relative_to_search.startsWith(`..${path.sep}`) ||
          path.isAbsolute(relative_to_search) ||
          relative_to_root === ".." ||
          relative_to_root.startsWith(`..${path.sep}`) ||
          path.isAbsolute(relative_to_root)
        ) {
          throw new SearchToolRuntimeError({
            error_code: "sandbox_denied",
            message: `Glob result escapes search path: ${relative_to_root_entry}`,
            search_path,
          });
        }
        files.push(to_posix_path(relative_to_root));
      }
    } finally {
      abort_signal?.removeEventListener("abort", abort_handler);
    }
    if (aborted) {
      throw new SearchToolRuntimeError({
        error_code: "aborted",
        message: "find search was aborted",
        search_path,
      });
    }
    files.sort((left, right) => left.localeCompare(right));
    return {
      success: true,
      root_path: resolved.root_path,
      search_path,
      pattern,
      files,
      match_count: files.length,
      truncated,
    };
  } catch (error) {
    return to_search_tool_failure(error, search_path || undefined);
  }
}

/** 执行一个项目搜索 action。 */
export async function run_search_action(
  context: { readonly rootPath: string },
  request: SearchToolActionRequest,
): Promise<SearchToolActionResult> {
  switch (request.action) {
    case "grep":
      return await grep_action(context, request.input, request.abort_signal);
    case "find":
      return await find_action(context, request.input, request.abort_signal);
    default:
      return {
        success: false,
        error_code: "internal_error",
        message: `Unknown search action: ${String((request as { action?: unknown }).action)}`,
      };
  }
}
