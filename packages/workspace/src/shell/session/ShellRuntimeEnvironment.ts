/**
 * Shell action 运行环境解析辅助。
 *
 * 关键点（中文）
 * - 集中处理 shell 子进程 cwd、env 与 owner context 的解析。
 * - 这里只做输入归一化，不持有 shell session 状态。
 */

import path from "node:path";
import type { ShellHostContext } from "@/shell/types/ShellHostContext.js";

function stripShellSecretEnv(env: NodeJS.ProcessEnv): void {
  delete env.DC_AUTH_TOKEN;
  delete env.DC_AGENT_TOKEN;
}

/**
 * 构造 shell 子进程环境变量。
 *
 * 关键点（中文）
 * - `sessionId` 显式传入时优先使用，避免依赖隐式运行状态。
 */
export function buildShellEnv(
  context: ShellHostContext,
  sessionId?: string,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };

  // 关键点（中文）
  // - ShellHostContext.env 现在就是宿主已经整理好的最终 env 视图。
  // - shell 只消费这一份显式上下文，避免再次引入 platform/global env 隐式来源。
  for (const [key, value] of Object.entries(context.env || {})) {
    const normalizedKey = String(key || "").trim();
    const normalizedValue = String(value || "").trim();
    if (!normalizedKey || !normalizedValue) continue;
    env[normalizedKey] = normalizedValue;
  }

  const explicitSessionId = String(sessionId || "").trim();
  const run_context = context.shellIntegration?.getRunContext?.();
  const resolvedSessionId = explicitSessionId || String(run_context?.sessionId || "").trim();
  const agentPath = String(context.rootPath || "").trim();
  const configuredAgentId = String(context.config?.id || "").trim();
  const agentId = configuredAgentId || (agentPath ? path.basename(agentPath) : "");

  // 关键点（中文）
  // - agent 自己在 shell 里执行 `downcity <service> ...` 时，也需要显式知道“当前 agent 是谁”。
  // - 否则 service CLI 会退回到当前终端 cwd / registry 猜测，在多 agent 或外部工作目录下
  //   很容易把请求发到错误项目，最终误报 “Agent runtime 没启动”。
  if (agentPath) env.DC_AGENT_PATH = agentPath;
  if (agentId) env.DC_AGENT_ID = agentId;
  if (resolvedSessionId) env.DC_SESSION_ID = resolvedSessionId;
  if (process.env.DC_CITY_HOST) env.DC_CITY_HOST = process.env.DC_CITY_HOST;
  if (process.env.DC_CITY_PORT) env.DC_CITY_PORT = process.env.DC_CITY_PORT;
  stripShellSecretEnv(env);

  return env;
}

/**
 * 解析 shell 执行目录。
 */
export function resolveShellCwd(context: ShellHostContext, cwd?: string): string {
  const raw = String(cwd || "").trim();
  if (!raw) return context.rootPath;
  return path.isAbsolute(raw) ? raw : path.resolve(context.rootPath, raw);
}

/**
 * 推断 shell 所属的 owner context。
 */
export function resolveOwnerContextId(
  context: ShellHostContext,
  explicit?: string,
): string | undefined {
  const fromInput = String(explicit || "").trim();
  if (fromInput) return fromInput;
  const fromRequest = String(context.shellIntegration?.getRunContext?.()?.sessionId || "").trim();
  return fromRequest || undefined;
}
