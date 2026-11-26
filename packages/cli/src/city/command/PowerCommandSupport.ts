/** Power CLI 的参数边界、唯一结果输出和安全错误处理。配置值不进入输出。 */
import type { Command } from "commander";
import { ExtensionFailure, ResourceError } from "@downcity/city/local";
import type { ManagedPower } from "../process/power/PowerManagement.js";

/** Commander 的长选项属性；camelCase 仅对应其固定参数映射。 */
export interface PowerCommandOptions {
  /** 显式 City 数据根。 */
  root?: string;
  /** 输出唯一 JSON 结果，禁止交互。 */
  json?: boolean;
  /** Git 分支、tag 或 commit。 */
  ref?: string;
  /** 代码来源操作的持久幂等 ID。 */
  operationId?: string;
  /** 完整普通配置 JSON 对象。 */
  set?: string;
  /** 完整普通配置 JSON 文件路径。 */
  configurationFile?: string;
  /** 从非交互 stdin 读取请求过的秘密字段 JSON。 */
  secretsStdin?: boolean;
  /** 多运行入口 Power 中显式选择的运行入口 ID。 */
  entry?: string;
}

/** 所有管理操作共享根路径与输出约定。 */
export function power_options(command: Command, mutation = false): Command {
  command.option("--root <path>", "City data root").option("--json", "Print one final JSON result");
  if (mutation) command.option("--operation-id <id>", "Resume a code-source operation");
  return command;
}

/** 运行一次命令，错误与结果使用相同 JSON 通道，不重复打印。 */
export async function run_power_command(options: PowerCommandOptions, execute: () => Promise<unknown>): Promise<void> {
  try {
    const result = await execute();
    if (result === undefined) return;
    process.stdout.write(`${options.json ? JSON.stringify(result) : format_power_result(result)}\n`);
    const power = result && typeof result === "object" && "power" in result ? result.power as ManagedPower : undefined;
    const error = power?.details?.error;
    if (error) process.exitCode = error.code === "configuration_required" ? 3 : error.code === "project_busy" ? 4 : error.stage === "source" && /invalid|missing|conflict/u.test(error.code) ? 2 : 1;
  } catch (error) {
    const known = error instanceof ExtensionFailure || error instanceof ResourceError;
    const message = (error instanceof Error ? error.message : "Power operation failed").replace(/extension/giu, "Power");
    const failure = { error: { code: known ? error.code : "power_failed", message } };
    (options.json ? process.stdout : process.stderr).write(`${options.json ? JSON.stringify(failure) : message}\n`);
    process.exitCode = known ? error.exit_code : 1;
  }
}

/** 人类输出保留来源、形态与实际状态，不把 pending 当作已加载。 */
function format_power_result(result: unknown): string {
  if (result && typeof result === "object" && "powers" in result && Array.isArray(result.powers)) return result.powers.map((item) => format_power_result({ power: item })).join("\n") || "No Powers";
  if (result && typeof result === "object" && "inspected" in result) return JSON.stringify(result, null, 2);
  if (result && typeof result === "object" && "power" in result && result.power) {
    const power = result.power as ManagedPower;
    return `${power.power_id}  ${power.title}  ${power.kind}  ${power.status}\n  ${power.source}${power.ref ? `#${power.ref}` : ""}${power.details?.error ? `\n${power.details.error.code}: ${power.details.error.message}` : ""}${power.details?.warnings?.length ? `\n${power.details.warnings.map((warning) => `${warning.code}: ${warning.message}`).join("\n")}` : ""}${"entries" in power ? `\n${JSON.stringify(power.entries, null, 2)}` : ""}`;
  }
  return JSON.stringify(result, null, 2);
}

/** 严格解析 JSON 对象，数组、null 和原始值都不能作为配置。 */
export function parse_power_object(input: string, label: string): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(input); }
  catch { throw new Error(`${label} must contain valid JSON`); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be a JSON object`);
  return value as Record<string, unknown>;
}
