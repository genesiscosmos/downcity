/**
 * `city env` 命令树。
 *
 * Env 直接写入平台 Global 或 Agent Workspace 的 `.env` 文件；修改完成后同步运行中的 Agent。
 */

import type { Command } from "commander";
import { emitCliBlock, emitCliList } from "@/shared/CliReporter.js";
import { printResult } from "@/city/utils/cli/CliOutput.js";
import { parseBoolean } from "@/shared/IndexSupport.js";
import { helpText, t } from "@/shared/CliLocale.js";
import {
  delete_env_target_value,
  read_env_target,
  resolve_agent_env_target,
  resolve_global_env_target,
  set_env_target_value,
} from "@/city/env/EnvService.js";
import { format_env_value } from "@/city/env/EnvFileStore.js";
import { run_interactive_env_manager } from "@/city/env/InteractiveEnvManager.js";
import type { EnvMutationResult, EnvTarget } from "@/city/types/env/EnvTarget.js";

/** Env 命令作用域参数。 */
interface EnvScopeOptions {
  /** 使用平台 Global Env。 */
  global?: boolean;
  /** 使用指定 Agent 的 Workspace Env。 */
  agent?: string;
  /** 是否输出 JSON。 */
  json?: boolean;
}

/** 解析并校验脚本命令的唯一 Env 目标。 */
async function resolve_env_target(options: EnvScopeOptions): Promise<EnvTarget> {
  if (options.global && String(options.agent || "").trim()) {
    throw new Error("Use either --global or --agent, not both");
  }
  if (options.global) return resolve_global_env_target();
  if (String(options.agent || "").trim()) return await resolve_agent_env_target(options.agent);
  throw new Error("Env scope is required: use --global or --agent <agent_id>");
}

/** 输出 Env key 列表，不显示 value。 */
async function emit_env_list(target: EnvTarget, as_json: boolean): Promise<void> {
  const env = await read_env_target(target);
  const keys = Object.keys(env).sort();
  if (as_json) {
    printResult({
      asJson: true,
      success: true,
      title: "env list",
      payload: {
        scope: target.scope,
        agent_id: target.agent_id,
        file_path: target.file_path,
        count: keys.length,
        keys,
      },
    });
    return;
  }
  if (keys.length === 0) {
    emitCliBlock({
      tone: "info",
      title: "Env",
      summary: "0 configured",
      facts: [{ label: "File", value: target.file_path }],
    });
    return;
  }
  emitCliList({
    tone: "accent",
    title: "Env",
    summary: `${keys.length} configured`,
    items: keys.map((key) => ({
      tone: "info",
      title: key,
      facts: [{ label: "Scope", value: target.scope }],
    })),
  });
}

/** 按 dotenv 格式输出目标 Env 明文。 */
async function emit_env_copy(target: EnvTarget): Promise<void> {
  assert_env_copy_allowed();
  const env = await read_env_target(target);
  const content = Object.keys(env)
    .sort()
    .map((key) => `${key}=${format_env_value(env[key])}`)
    .join("\n");
  process.stdout.write(content ? `${content}\n` : "");
}

/** 输出 Env 修改结果和在线广播状态。 */
function emit_mutation_result(result: EnvMutationResult, as_json: boolean): void {
  const payload = {
    scope: result.target.scope,
    agent_id: result.target.agent_id,
    file_path: result.target.file_path,
    key: result.key,
    changed: result.changed,
    broadcast: result.broadcast,
  };
  if (as_json) {
    printResult({
      asJson: true,
      success: result.broadcast.failed_agents.length === 0,
      title: "env update",
      payload,
    });
    return;
  }
  emitCliBlock({
    tone: result.broadcast.failed_agents.length > 0 ? "warning" : "success",
    title: result.changed ? "Env saved" : "Env unchanged",
    summary: result.key,
    facts: [
      { label: "File", value: result.target.file_path },
      { label: "Agents updated", value: String(result.broadcast.updated_agent_ids.length) },
      { label: "Sync failures", value: String(result.broadcast.failed_agents.length) },
    ],
    note: result.broadcast.failed_agents.length > 0
      ? result.broadcast.failed_agents.map((item) => `${item.agent_id}: ${item.error}`).join("\n")
      : undefined,
  });
}

/** 禁止 Agent Shell 读取 Env 明文。 */
function assert_env_copy_allowed(): void {
  if (!String(process.env.DC_AGENT_PATH || "").trim() && !String(process.env.DC_AGENT_ID || "").trim()) return;
  throw new Error("city env copy can only be run from the local CLI, not from an agent shell");
}

/** 为子命令注册统一作用域参数。 */
function add_scope_options(command: Command): Command {
  return command
    .option("--global", t({ zh: "使用 ~/.downcity/.env", en: "use ~/.downcity/.env" }))
    .option("--agent <agent_id>", t({ zh: "使用 Agent Workspace 的 .env", en: "use an Agent Workspace .env" }));
}

/** 注册 `city env` 命令组。 */
export function registerEnvCommand(program: Command): void {
  const env = program
    .command("env")
    .description(t({ zh: "管理 Global 或 Agent Workspace Env", en: "manage Global or Agent Workspace Env" }))
    .helpOption("--help", helpText());

  add_scope_options(env.command("list"))
    .description(t({ zh: "列出已配置的 Env key", en: "list configured Env keys" }))
    .option("--json [enabled]", t({ zh: "以 JSON 输出", en: "output as JSON" }), parseBoolean)
    .helpOption("--help", helpText())
    .action(async (options: EnvScopeOptions) => {
      await emit_env_list(await resolve_env_target(options), options.json === true);
    });

  add_scope_options(env.command("set <key> <value>"))
    .description(t({ zh: "新增或更新 Env key", en: "create or update an Env key" }))
    .option("--json [enabled]", t({ zh: "以 JSON 输出", en: "output as JSON" }), parseBoolean)
    .helpOption("--help", helpText())
    .action(async (key: string, value: string, options: EnvScopeOptions) => {
      emit_mutation_result(
        await set_env_target_value(await resolve_env_target(options), key, value),
        options.json === true,
      );
    });

  add_scope_options(env.command("delete <key>"))
    .description(t({ zh: "删除 Env key", en: "delete an Env key" }))
    .option("--json [enabled]", t({ zh: "以 JSON 输出", en: "output as JSON" }), parseBoolean)
    .helpOption("--help", helpText())
    .action(async (key: string, options: EnvScopeOptions) => {
      emit_mutation_result(
        await delete_env_target_value(await resolve_env_target(options), key),
        options.json === true,
      );
    });

  add_scope_options(env.command("copy"))
    .description(t({ zh: "按 dotenv 格式输出 Env 明文", en: "print Env values in dotenv format" }))
    .helpOption("--help", helpText())
    .action(async (options: EnvScopeOptions) => {
      await emit_env_copy(await resolve_env_target(options));
    });

  env.action(async () => {
    if (process.stdin.isTTY && process.stdout.isTTY) {
      await run_interactive_env_manager();
      return;
    }
    throw new Error("Env scope is required: use --global or --agent <agent_id>");
  });
  env.showHelpAfterError();
  env.showSuggestionAfterError();
}
