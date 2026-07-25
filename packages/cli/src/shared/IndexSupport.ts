/**
 * CLI 入口共享工具。
 *
 * 关键点（中文）
 * - 统一承载 `Index.ts`、console 命令、agent 命令共用的参数解析与上下文注入逻辑。
 * - 保持共享工具纯函数化，避免命令装配文件继续膨胀。
 */

import { basename, dirname, resolve } from "path";
import { emitCliHeader, emitCliBlock, resetCliSectionFlow } from "@/shared/CliReporter.js";
import { CliError } from "@/shared/CliError.js";
import type { DaemonTarget } from "@/city/process/daemon/Types.js";

/**
 * 在关键运行命令执行前打印当前终端命令版本。
 *
 * 说明（中文）
 * - 仅用于 runtime 相关命令，避免影响 `config --json` 等结构化输出。
 * - 全局 catch CliError，统一渲染错误输出。
 */
export function createVersionBanner<TArgs extends unknown[]>(
  version: string,
  action: (...args: TArgs) => Promise<void> | void,
  command_name: string = resolveCurrentCommandName(),
): (...args: TArgs) => Promise<void> {
  return async (...args: TArgs): Promise<void> => {
    // 关键点（中文）：`--json` 场景禁止在 stdout 混入 banner，避免破坏机器可解析输出。
    const hasJsonMode = args.some((arg) => {
      if (!arg || typeof arg !== "object") return false;
      if (!Object.prototype.hasOwnProperty.call(arg, "json")) return false;
      return (arg as { json?: unknown }).json === true;
    });
    if (!hasJsonMode) {
      resetCliSectionFlow();
      emitCliHeader(version, { command_name });
    }

    try {
      await action(...args);
    } catch (error) {
      if (error instanceof CliError) {
        if (hasJsonMode) {
          console.log(
            JSON.stringify(
              {
                success: false,
                error: error.message,
                ...(error.note ? { detail: error.note } : {}),
                ...(error.fix ? { fix: error.fix } : {}),
              },
              null,
              2,
            ),
          );
        } else {
          emitCliBlock({
            tone: "error",
            title: error.message,
            note: error.note,
            facts: error.fix ? [{ label: "fix", value: error.fix }] : undefined,
          });
        }
        process.exitCode = error.exitCode;
        return;
      }
      // 非 CliError 继续向上抛，让 Node.js 默认处理。
      throw error;
    }
  };
}

/**
 * 从当前入口文件推断 banner 应展示的命令名。
 *
 * 关键点（中文）
 * - 用户全局安装的是 `downcity` 聚合包，但实际执行的是 `city` 或 `city`。
 * - 聚合包与拆分包的入口都位于 `bin/<command>/index.js`，优先读取父目录名。
 */
function resolveCurrentCommandName(): string {
  const entry_path = process.argv[1] || "";
  const command_name = basename(dirname(entry_path));
  if (command_name === "city" || command_name === "city") return command_name;

  const file_name = basename(entry_path).replace(/\.[cm]?js$/, "");
  if (file_name === "city" || file_name === "city") return file_name;

  return "downcity";
}

/**
 * 解析端口参数。
 */
export function parsePort(value: string): number {
  const num = Number.parseInt(value, 10);
  if (
    !Number.isFinite(num) ||
    Number.isNaN(num) ||
    !Number.isInteger(num) ||
    num <= 0 ||
    num > 65535
  ) {
    throw new Error(`Invalid port: ${value}`);
  }
  return num;
}

/**
 * 解析布尔参数。
 */
export function parseBoolean(value: string | undefined): boolean {
  if (value === undefined) return true;
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "n", "off"].includes(normalized)) return false;
  throw new Error(`Invalid boolean: ${value}`);
}

/**
 * 异步睡眠工具。
 */
export const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 注入当前 agent 执行上下文。
 */
export function inject_agent_context(target: DaemonTarget): {
  workspace_path: string;
  agent_id: string;
} {
  const workspace_path = resolve(target.workspace_path);
  process.env.DC_AGENT_PATH = workspace_path;
  process.env.DC_AGENT_ID = target.agent_id;
  return { workspace_path, agent_id: target.agent_id };
}
