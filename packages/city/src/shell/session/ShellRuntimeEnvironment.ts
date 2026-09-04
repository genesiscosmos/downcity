/**
 * Shell action 运行环境解析辅助。
 *
 * 关键点（中文）
 * - 集中处理 shell 子进程 cwd、env 与 owner context 的解析。
 * - 这里只做输入归一化，不持有 shell session 状态。
 */

import path from "node:path";
import type { ShellHostContext } from "@downcity/type/shell";

function strip_shell_secret_env(env: NodeJS.ProcessEnv): void {
  delete env.DC_AUTH_TOKEN;
  delete env.DC_AGENT_TOKEN;
}

/**
 * 构造 shell 子进程环境变量。
 *
 * 关键点（中文）
 * - `session_id` 显式传入时优先使用，避免依赖隐式运行状态。
 */
export function build_shell_env(
  context: ShellHostContext,
  session_id?: string,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };

  // 关键点（中文）
  // - ShellHostContext.env 现在就是宿主已经整理好的最终 env 视图。
  // - shell 只消费这一份显式上下文，避免再次引入 platform/global env 隐式来源。
  for (const [key, value] of Object.entries(context.env || {})) {
    const normalized_key = String(key || "").trim();
    const normalized_value = String(value || "").trim();
    if (!normalized_key || !normalized_value) continue;
    env[normalized_key] = normalized_value;
  }

  const explicit_session_id = String(session_id || "").trim();
  const run_context = context.shell_integration?.get_run_context?.();
  const resolved_session_id = explicit_session_id || String(run_context?.session_id || "").trim();
  const agent_path = String(context.root_path || "").trim();
  const configured_agent_id = String(context.config?.id || "").trim();
  const agent_id = configured_agent_id || (agent_path ? path.basename(agent_path) : "");

  // 关键点（中文）
  // - agent 自己在 shell 里执行 `downcity <service> ...` 时，也需要显式知道“当前 agent 是谁”。
  // - 否则 service CLI 会退回到当前终端 cwd / registry 猜测，在多 agent 或外部工作目录下
  //   很容易把请求发到错误项目，最终误报 “Agent runtime 没启动”。
  if (agent_path) env.DC_AGENT_PATH = agent_path;
  if (agent_id) env.DC_AGENT_ID = agent_id;
  if (resolved_session_id) env.DC_SESSION_ID = resolved_session_id;
  if (process.env.DC_CITY_HOST) env.DC_CITY_HOST = process.env.DC_CITY_HOST;
  if (process.env.DC_CITY_PORT) env.DC_CITY_PORT = process.env.DC_CITY_PORT;
  strip_shell_secret_env(env);

  return env;
}

/**
 * 解析 shell 执行目录。
 */
export function resolve_shell_cwd(context: ShellHostContext, cwd?: string): string {
  const raw = String(cwd || "").trim();
  if (!raw) return context.root_path;
  return path.isAbsolute(raw) ? raw : path.resolve(context.root_path, raw);
}

/**
 * 推断 shell 所属的 owner context。
 */
export function resolve_owner_context_id(
  context: ShellHostContext,
  explicit?: string,
): string | undefined {
  const from_input = String(explicit || "").trim();
  if (from_input) return from_input;
  const from_request = String(context.shell_integration?.get_run_context?.()?.session_id || "").trim();
  return from_request || undefined;
}
