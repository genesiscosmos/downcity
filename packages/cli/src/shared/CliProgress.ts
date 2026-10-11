/**
 * CLI 长任务进度渲染器。
 *
 * 交互终端使用单行 spinner，CI、重定向输出与测试环境使用稳定的阶段日志。所有路径
 * 都显示当前任务、可选命令和耗时，避免部署过程中出现无法解释的静默等待。
 */

import ora from "ora";
import type { CliProgressInput } from "@/shared/types/CliProgress.js";
import { is_cli_quiet } from "@/shared/CliReporter.js";

/** 执行异步任务并展示一致的进度、完成或失败状态。 */
export async function with_cli_progress<TResult>(
  input: CliProgressInput,
  task: () => Promise<TResult>,
): Promise<TResult> {
  const started_at = Date.now();
  const text = format_progress_text(input);
  const quiet = is_cli_quiet();
  const use_spinner = !quiet
    && input.animate !== false
    && process.stdout.isTTY === true
    && process.env.CI !== "true";
  const spinner = use_spinner ? ora({ text, stream: process.stdout }).start() : undefined;

  if (!spinner && !quiet) process.stdout.write(`→ ${text}\n`);
  try {
    const result = await task();
    const completed = `${input.title} · completed in ${format_duration(Date.now() - started_at)}`;
    if (spinner) spinner.succeed(completed);
    else if (!quiet) process.stdout.write(`✓ ${completed}\n`);
    return result;
  } catch (error) {
    const failed = `${input.title} · failed after ${format_duration(Date.now() - started_at)}`;
    if (spinner) spinner.fail(failed);
    else process.stderr.write(`✗ ${failed}\n`);
    throw error;
  }
}

/** 组合任务标题与当前执行细节。 */
function format_progress_text(input: CliProgressInput): string {
  const detail = input.detail?.trim();
  return detail ? `${input.title} · ${detail}` : input.title;
}

/** 将毫秒格式化为紧凑且稳定的耗时文本。 */
function format_duration(duration_ms: number): string {
  if (duration_ms < 1_000) return `${Math.max(0, duration_ms)}ms`;
  return `${(duration_ms / 1_000).toFixed(1)}s`;
}
