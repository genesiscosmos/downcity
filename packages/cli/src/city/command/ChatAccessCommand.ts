/**
 * `downcity chat access` 命令。
 *
 * 关键点（中文）
 * - Chat Access 属于 Chat Plugin，只管理外部 Chat 用户进入指定 Agent 前的准入。
 * - 所有管理操作通过 ChatAccessService 完成，CLI 不直接读写 SQLite。
 * - 目标 Agent 按显式参数、Agent 环境、当前已登记目录、TTY 选择的顺序解析。
 */

import path from "node:path";
import type { Command } from "commander";
import prompts from "@/city/tui/Prompts.js";
import {
  ChatAccessService,
  type ChatAccessEffect,
  type ChatAccessRequestStatus,
} from "@downcity/plugins/chat";
import {
  get_managed_agent,
  get_managed_agent_by_workspace,
  list_managed_agents,
} from "@/city/process/registry/ManagedAgentRepository.js";
import type { ManagedAgent } from "@/city/types/agent/ManagedAgent.js";
import type {
  ChatAccessCommandOptions,
  ChatAccessRequestsOptions,
  ChatAccessResolveOptions,
  ChatAccessRevokeOptions,
  ChatAccessSetOptions,
  ChatAccessTarget as CliChatAccessTarget,
} from "@/city/types/ChatAccessCommand.js";
import { CliError } from "@/shared/CliError.js";
import { printResult } from "@/city/utils/cli/CliOutput.js";
import { createVersionBanner, parseBoolean } from "@/shared/IndexSupport.js";
import { helpText, t } from "@/shared/CliLocale.js";

const REQUEST_STATUSES: ChatAccessRequestStatus[] = [
  "pending",
  "approved",
  "denied",
  "expired",
];

function is_interactive_terminal(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

function find_agent_by_id(agent_id: string): ManagedAgent | null {
  return get_managed_agent(agent_id);
}

function find_agent_by_path(project_root_input: string): ManagedAgent | null {
  const project_root = path.resolve(project_root_input);
  return get_managed_agent_by_workspace(project_root);
}

async function choose_agent(): Promise<ManagedAgent | null> {
  const configs = list_managed_agents();
  if (configs.length === 0) return null;
  const response = (await prompts({
    type: "select",
    name: "project_root",
    message: t({ zh: "选择要管理 Chat Access 的 Agent", en: "Select the Agent whose Chat Access you want to manage" }),
    choices: configs.map((config) => ({
      title: config.agent_id,
      description: config.workspace_path,
      value: config.agent_id,
    })),
    initial: 0,
  })) as { project_root?: string };
  const agent_id = String(response.project_root || "").trim();
  return agent_id ? find_agent_by_id(agent_id) : null;
}

/** 交互式选择 Chat Access 的目标 Agent。 */
export async function choose_chat_access_target(): Promise<CliChatAccessTarget> {
  if (!is_interactive_terminal()) {
    throw new CliError({ title: "Chat Access Agent 选择需要交互式终端" });
  }
  const config = await choose_agent();
  if (config) return to_target(config);
  throw new CliError({
    title: "没有可管理的 Agent",
    fix: "先运行 `downcity agent create` 创建 Agent。",
  });
}

function to_target(config: ManagedAgent): CliChatAccessTarget {
  return {
    agent_id: config.agent_id,
    project_root: path.resolve(config.workspace_path),
    config,
  };
}

/**
 * 解析 Chat Access 命令目标。
 */
export async function resolve_chat_access_target(
  options: ChatAccessCommandOptions = {},
  allow_prompt = true,
): Promise<CliChatAccessTarget> {
  const explicit_agent = String(options.agent || "").trim();
  if (explicit_agent) {
    const config = find_agent_by_id(explicit_agent);
    if (config) return to_target(config);
    throw new CliError({
      title: `找不到 Agent：${explicit_agent}`,
      fix: "运行 `downcity agent list` 查看已登记 Agent。",
    });
  }

  const explicit_path = String(options.path || "").trim();
  if (explicit_path) {
    const project_root = path.resolve(explicit_path);
    const config = find_agent_by_path(project_root);
    if (config) return to_target(config);
    throw new CliError({
      title: "指定目录不是已登记的 Agent 项目",
      note: project_root,
      fix: "先运行 `downcity agent create` 或选择正确的 `--agent`。",
    });
  }

  const environment_agent = String(process.env.DC_AGENT_ID || "").trim();
  if (environment_agent) {
    const config = find_agent_by_id(environment_agent);
    if (config) return to_target(config);
  }

  const environment_path = String(process.env.DC_AGENT_PATH || "").trim();
  if (environment_path) {
    const config = find_agent_by_path(environment_path);
    if (config) return to_target(config);
  }

  const current_config = find_agent_by_path(".");
  if (current_config) return to_target(current_config);

  if (allow_prompt && is_interactive_terminal()) {
    const config = await choose_agent();
    if (config) return to_target(config);
  }

  throw new CliError({
    title: "无法确定 Chat Access 的目标 Agent",
    fix: "请传入 `--agent <agent_id>` 或 `--path <project_root>`。",
  });
}

function parse_scope(value: string): "direct" | "group" | "all" {
  const scope = String(value || "").trim();
  if (scope === "direct" || scope === "group" || scope === "all") return scope;
  throw new Error(`Invalid Chat Access scope: ${value}. Use direct|group|all.`);
}

function parse_effect(value: string): "allow" | "deny" {
  const effect = String(value || "").trim();
  if (effect === "allow" || effect === "deny") return effect;
  throw new Error(`Invalid Chat Access effect: ${value}. Use allow|deny.`);
}

/** 创建目标 Agent 的 Chat Access Service。 */
export function create_chat_access_service_for_target(
  target: CliChatAccessTarget,
): ChatAccessService {
  return new ChatAccessService({
    project_root: target.project_root,
  });
}

function target_payload(target: CliChatAccessTarget): Record<string, unknown> {
  return {
    agent_id: target.agent_id,
    project_root: target.project_root,
  };
}

/** 输出 Access Request 列表。 */
export async function run_chat_access_requests(options: ChatAccessRequestsOptions): Promise<void> {
  const target = await resolve_chat_access_target(options);
  const requests = create_chat_access_service_for_target(target).list_requests(options.status);
  if (options.json === true) {
    printResult({ asJson: true, success: true, title: "chat_access_requests", payload: {
      ...target_payload(target), count: requests.length, requests,
    } });
    return;
  }
  printResult({ asJson: false, success: true, type: "list", title: "Chat Access requests",
    summary: `${requests.length} · ${target.agent_id}`,
    items: requests.map((request) => ({
      tone: request.status === "pending" ? "warning" : "info",
      title: request.request_id,
      facts: [
        { label: "Identity", value: `${request.principal.channel}:${request.principal.issuer}:${request.principal.subject_id}` },
        { label: "Scope", value: request.scope },
        { label: "Status", value: request.status },
        { label: "Last request", value: request.last_requested_at },
      ],
    })),
  });
}

/** 输出已观测 Principal 和 Grant。 */
export async function run_chat_access_list(options: ChatAccessCommandOptions): Promise<void> {
  const target = await resolve_chat_access_target(options);
  const principals = create_chat_access_service_for_target(target).list_principals();
  if (options.json === true) {
    printResult({ asJson: true, success: true, title: "chat_access_principals", payload: {
      ...target_payload(target), count: principals.length, principals,
    } });
    return;
  }
  printResult({ asJson: false, success: true, type: "list", title: "Chat Access principals",
    summary: `${principals.length} · ${target.agent_id}`,
    items: principals.map((item) => ({
      tone: item.grants.some((grant) => grant.effect === "allow") ? "success" : "info",
      title: item.principal.display_name || item.principal.subject_id,
      facts: [
        { label: "Principal", value: item.principal.principal_id },
        { label: "Identity", value: `${item.principal.channel}:${item.principal.issuer}:${item.principal.subject_id}` },
        { label: "Grants", value: item.grants.map((grant) => `${grant.scope}:${grant.effect}`).join(", ") || "none" },
        { label: "Last seen", value: item.principal.last_seen_at },
      ],
    })),
  });
}

async function run_request_resolution(input: {
  request_id: string;
  effect: ChatAccessEffect;
  options: ChatAccessResolveOptions;
}): Promise<void> {
  const target = await resolve_chat_access_target(input.options);
  const service = create_chat_access_service_for_target(target);
  const grants = input.effect === "allow"
    ? service.approve_request({ request_id: input.request_id, scope: input.options.scope, operator: "local-cli" })
    : service.deny_request({ request_id: input.request_id, scope: input.options.scope, operator: "local-cli" });
  printResult({ asJson: input.options.json === true, success: true, title: `Chat Access ${input.effect}`,
    payload: { ...target_payload(target), request_id: input.request_id,
      principal_id: grants[0]?.principal_id || "", grants,
    },
  });
}

/** 直接设置已观测 Principal 的 Grant。 */
export async function run_chat_access_set(
  principal_id: string,
  options: ChatAccessSetOptions,
): Promise<void> {
  const target = await resolve_chat_access_target(options);
  const grants = create_chat_access_service_for_target(target).set_principal_effect({
    principal_id,
    scope: options.scope,
    effect: options.effect,
    operator: "local-cli",
  });
  printResult({ asJson: options.json === true, success: true, title: "Chat Access updated",
    payload: { ...target_payload(target), principal_id, grants },
  });
}

/** 撤销已观测 Principal 的 Grant。 */
export async function run_chat_access_revoke(
  principal_id: string,
  options: ChatAccessRevokeOptions,
): Promise<void> {
  const target = await resolve_chat_access_target(options);
  const removed_count = create_chat_access_service_for_target(target).revoke_grant({
    principal_id,
    scope: options.scope,
    operator: "local-cli",
  });
  printResult({ asJson: options.json === true, success: true, title: "Chat Access revoked",
    payload: { ...target_payload(target), principal_id, scope: options.scope, removed_count },
  });
}

function add_target_options(command: Command): Command {
  return command
    .option("--agent <agent_id>", t({ zh: "目标 Agent ID", en: "target Agent ID" }))
    .option("--path <project_root>", t({ zh: "目标 Agent 项目根目录", en: "target Agent project root" }))
    .option("--json [enabled]", t({ zh: "输出 JSON", en: "output JSON" }), parseBoolean, false)
    .helpOption("--help", helpText());
}

/** 注册 `downcity chat access` 命令组。 */
export function register_chat_access_commands(chat: Command, version: string): void {
  const access = chat.command("access").description(t({
    zh: "管理指定 Agent 的 Chat 用户准入",
    en: "manage Chat user access for a specific Agent",
  })).helpOption("--help", helpText());

  add_target_options(access.command("requests").description(t({ zh: "列出 Access Request", en: "list access requests" }))
    .option("--status <status>", t({ zh: "按状态过滤", en: "filter by status" }), (value: string) => {
      const status = String(value).trim() as ChatAccessRequestStatus;
      if (!REQUEST_STATUSES.includes(status)) throw new Error(`Invalid request status: ${value}`);
      return status;
    }))
    .action(createVersionBanner(version, async (options: ChatAccessRequestsOptions) => run_chat_access_requests(options)));

  add_target_options(access.command("list").description(t({ zh: "列出 Principal 和 Grant", en: "list principals and grants" })))
    .action(createVersionBanner(version, async (options: ChatAccessCommandOptions) => run_chat_access_list(options)));

  add_target_options(access.command("approve <request_id>").description(t({ zh: "批准待处理请求", en: "approve a pending request" }))
    .option("--scope <scope>", t({ zh: "direct、group 或 all", en: "direct, group, or all" }), parse_scope))
    .action(createVersionBanner(version, async (request_id: string, options: ChatAccessResolveOptions) => run_request_resolution({ request_id, effect: "allow", options })));

  add_target_options(access.command("deny <request_id>").description(t({ zh: "拒绝待处理请求", en: "deny a pending request" }))
    .option("--scope <scope>", t({ zh: "direct、group 或 all", en: "direct, group, or all" }), parse_scope))
    .action(createVersionBanner(version, async (request_id: string, options: ChatAccessResolveOptions) => run_request_resolution({ request_id, effect: "deny", options })));

  add_target_options(access.command("set <principal_id>").description(t({ zh: "设置已观测 Principal 的 Grant", en: "set grants for an observed principal" }))
    .requiredOption("--scope <scope>", t({ zh: "direct、group 或 all", en: "direct, group, or all" }), parse_scope)
    .requiredOption("--effect <effect>", t({ zh: "allow 或 deny", en: "allow or deny" }), parse_effect))
    .action(createVersionBanner(version, async (principal_id: string, options: ChatAccessSetOptions) => run_chat_access_set(principal_id, options)));

  add_target_options(access.command("revoke <principal_id>").description(t({ zh: "撤销 Principal 的 Grant", en: "revoke principal grants" }))
    .requiredOption("--scope <scope>", t({ zh: "direct、group 或 all", en: "direct, group, or all" }), parse_scope))
    .action(createVersionBanner(version, async (principal_id: string, options: ChatAccessRevokeOptions) => run_chat_access_revoke(principal_id, options)));
}
