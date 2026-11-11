/**
 * 本地 find 的异步文件发现。
 *
 * ripgrep 在独立进程中按目录应用忽略规则；picomatch 仅匹配已发现的相对路径，
 * 不在宿主主线程递归收集 .gitignore。NUL 分隔保留文件名中的换行，所有进程管道
 * 都被消费并等待关闭；取消、超限或读取失败时终止进程，必要时升级为 SIGKILL。
 */
import { spawn } from "node:child_process";
import path from "node:path";
import picomatch from "picomatch";
import type { FindFileSearchOptions, FindFileSearchResult } from "@/types/workspace/FindFileSearch.js";
import { SearchToolRuntimeError } from "./SearchToolError.js";

const max_stderr_chars = 16_000;
const terminate_grace_ms = 500;

/** 将已校验范围内的文件路径转换为项目相对 POSIX 路径。 */
function resolve_found_path(root_path: string, search_path: string, entry: string): string {
  const absolute_path = path.resolve(root_path, entry);
  for (const boundary of [search_path, root_path]) {
    const relative_path = path.relative(boundary, absolute_path);
    if (relative_path === ".." || relative_path.startsWith(`..${path.sep}`) || path.isAbsolute(relative_path)) {
      throw new SearchToolRuntimeError({
        error_code: "sandbox_denied",
        message: "File search returned a path outside the search directory",
        search_path,
      });
    }
  }
  return path.relative(root_path, absolute_path).split(path.sep).join("/");
}

/** 执行可取消、有结果上限的枚举；不将正向 glob 传给 rg，避免其覆盖忽略规则。 */
export async function find_files(options: FindFileSearchOptions): Promise<FindFileSearchResult> {
  const { root_path, search_path, pattern, max_results, abort_signal } = options;
  const abort_error = (): SearchToolRuntimeError => new SearchToolRuntimeError({
    error_code: "aborted",
    message: "find search was aborted",
    search_path,
  });
  if (abort_signal?.aborted) throw abort_error();
  // picomatch 与原 fast-glob 使用相同的路径匹配语义；不启用 basename 匹配。
  const matches_pattern = picomatch(pattern, { dot: true });
  const search_prefix = path.relative(root_path, search_path).split(path.sep).join("/");
  const prefix = search_prefix ? `${search_prefix}/` : "";
  // 从项目根枚举，避免把显式搜索目录当作 rg 的输入根而绕过其父级忽略规则。
  const child = spawn("rg", [
    "--files", "--null", "--hidden", "--no-config", "--no-require-git",
    "--glob", "!**/.git/**", "--", ".",
  ], { cwd: root_path, stdio: ["ignore", "pipe", "pipe"] });
  const files: string[] = [];
  let stderr = "";
  let truncated = false;
  let aborted = false;
  let closed = false;
  let stopping = false;
  let kill_timer: ReturnType<typeof setTimeout> | undefined;

  /** 停止后继续排空管道；若子进程未响应 SIGTERM，限时强制终止。 */
  const stop_child = (): void => {
    if (stopping) return;
    stopping = true;
    if (closed) return;
    child.kill("SIGTERM");
    kill_timer = setTimeout(() => {
      if (!closed) child.kill("SIGKILL");
    }, terminate_grace_ms);
    kill_timer.unref();
  };
  const completion = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => {
      closed = true;
      if (kill_timer) clearTimeout(kill_timer);
      resolve(code);
    });
  });
  const abort_handler = (): void => {
    aborted = true;
    stop_child();
  };
  abort_signal?.addEventListener("abort", abort_handler, { once: true });
  // 信号可能在路径校验或进程创建期间取消；注册监听后重新检查。
  if (abort_signal?.aborted) abort_handler();

  const read_output = async (): Promise<void> => {
    let pending = "";
    child.stdout.setEncoding("utf8");
    try {
      for await (const chunk of child.stdout) {
        if (stopping) continue;
        pending += String(chunk);
        let offset = 0;
        let end: number;
        while ((end = pending.indexOf("\0", offset)) !== -1) {
          const entry = pending.slice(offset, end);
          offset = end + 1;
          const root_relative_path = entry.startsWith("./") ? entry.slice(2) : entry;
          if (!root_relative_path.startsWith(prefix)) continue;
          const relative_path = root_relative_path.slice(prefix.length);
          if (!matches_pattern(relative_path)) continue;
          if (files.length >= max_results) {
            truncated = true;
            stop_child();
            break;
          }
          files.push(resolve_found_path(root_path, search_path, entry));
        }
        pending = stopping ? "" : pending.slice(offset);
      }
      if (pending && !stopping) {
        throw new SearchToolRuntimeError({
          error_code: "search_failed",
          message: "ripgrep returned an incomplete file path",
          search_path,
        });
      }
    } catch (error) {
      stop_child();
      throw error;
    }
  };
  const read_errors = async (): Promise<void> => {
    child.stderr.setEncoding("utf8");
    try {
      for await (const chunk of child.stderr) {
        if (stderr.length < max_stderr_chars) stderr += String(chunk).slice(0, max_stderr_chars - stderr.length);
      }
    } catch (error) {
      stop_child();
      throw error;
    }
  };
  try {
    // 所有失败都等到管道结束后再处理，防止拒绝泄漏或遗留子进程。
    const [output_result, errors_result, process_result] = await Promise.allSettled([
      read_output(), read_errors(), completion,
    ]);
    if (aborted) throw abort_error();
    if (process_result.status === "rejected") {
      if ((process_result.reason as NodeJS.ErrnoException).code === "ENOENT") {
        throw new SearchToolRuntimeError({
          error_code: "rg_unavailable",
          message: "ripgrep executable 'rg' was not found in PATH",
          search_path,
        });
      }
      throw process_result.reason;
    }
    if (output_result.status === "rejected") throw output_result.reason;
    if (errors_result.status === "rejected") throw errors_result.reason;
    if (!truncated && process_result.value !== 0 && process_result.value !== 1) {
      throw new SearchToolRuntimeError({
        error_code: "search_failed",
        message: stderr.trim() || `ripgrep exited with code ${String(process_result.value)}`,
        search_path,
      });
    }
    files.sort((left, right) => left.localeCompare(right));
    return { files, truncated };
  } finally {
    abort_signal?.removeEventListener("abort", abort_handler);
    if (kill_timer) clearTimeout(kill_timer);
  }
}
