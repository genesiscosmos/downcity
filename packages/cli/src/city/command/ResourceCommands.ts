/** Agent/Workspace/Session 显式命令注册；仅解析输入并调用共用资源客户端。 */
import type { Command } from "commander";
import { execute_resource_command, resource_options } from "../resources/ResourceOutput.js";

/** Agent CRUD，独立于项目初始化和模型选择交互。 */
export function register_agent_resource_commands(agent: Command): void {
  resource_options(agent.command("create").description("Create an Agent identity without initializing a project").option("--name <name>").option("--id <id>").option("--description <text>").option("--model <model_id>").option("--instruction-file <path>"))
    .action(async (options) => await execute_resource_command("agent.create", options));
  resource_options(agent.command("list").description("List registered and current runtime Agents").option("--query <text>").option("--loaded").option("--unloaded"))
    .action(async (options) => await execute_resource_command("agent.list", options));
  resource_options(agent.command("get <agent_id>").option("--include-instruction"))
    .action(async (id, options) => await execute_resource_command("agent.get", options, { id }));
  resource_options(agent.command("update <agent_id>").option("--name <name>").option("--description <text>").option("--model <model_id>").option("--unset-model").option("--instruction-file <path>").option("--if-revision <hash>"))
    .action(async (id, options) => await execute_resource_command("agent.update", options, { id }));
  resource_options(agent.command("delete <agent_id>").description("Permanently delete Agent-owned data after reference and execution checks").option("--if-revision <hash>").option("--yes"))
    .action(async (id, options) => await execute_resource_command("agent.delete", options, { id }));
}

/** 项目登记树；移除保留项目、历史和附件。 */
export function register_workspace_commands(program: Command): void {
  const workspace = program.command("workspace").description("Manage project Workspace registrations");
  resource_options(workspace.command("register <path>").option("--name <name>").option("--ssh <host>", "System OpenSSH target; remote path must be absolute").option("--initialize-dependencies", "Install missing Python, ripgrep and ps on the SSH host before registering"))
    .action(async (path, options) => await execute_resource_command("workspace.register", options, { path, ...(options.ssh ? { source: { kind: "ssh", host: options.ssh } } : {}) }));
  resource_options(workspace.command("initialize <workspace_id>").description("Install missing Python, ripgrep and ps on a registered SSH host"))
    .action(async (id, options) => await execute_resource_command("workspace.initialize", options, { id }));
  resource_options(workspace.command("list").option("--query <text>").option("--include-internal"))
    .action(async (options) => await execute_resource_command("workspace.list", options));
  resource_options(workspace.command("get <workspace_id>"))
    .action(async (id, options) => await execute_resource_command("workspace.get", options, { id }));
  resource_options(workspace.command("update <workspace_id>").option("--name <name>").option("--if-revision <hash>"))
    .action(async (id, options) => await execute_resource_command("workspace.update", options, { id }));
  resource_options(workspace.command("remove <workspace_id>").option("--if-revision <hash>").option("--yes"))
    .action(async (id, options) => await execute_resource_command("workspace.remove", options, { id }));
}

/** 会话地址始终携带 Agent 和 category；不暴露伪造的 origin 或 actor。 */
export function register_session_commands(program: Command): void {
  const session = program.command("session").description("Browse and manage Agent-owned Sessions");
  const common = (command: Command): Command => resource_options(command.option("--agent <agent_id>").option("--category <category>", "chat or work", "work"));
  common(session.command("create").option("--workspace <id>").option("--workspace-path <path>"))
    .action(async (options) => await execute_resource_command("session.create", options));
  common(session.command("list").option("--workspace <id>").option("--origin-type <type>").option("--query <text>").option("--archived").option("--limit <number>").option("--cursor <opaque>"))
    .action(async (options) => await execute_resource_command("session.list", options));
  common(session.command("get <session_id>").option("--archived", "Read one archived record; requires --storage-id").option("--storage-id <uuid>", "Exact immutable archived record identity"))
    .action(async (session_id, options) => await execute_resource_command("session.get", options, { session_id }));
  common(session.command("history <session_id>").option("--archived", "Read one archived record; requires --storage-id").option("--storage-id <uuid>", "Exact immutable archived record identity").option("--before-sequence <number>").option("--limit <number>").option("--include-internal"))
    .action(async (session_id, options) => await execute_resource_command("session.history", options, { session_id }));
  common(session.command("send <session_id>").option("--message <text>").option("--message-file <path-or-dash>").option("--request-id <id>").option("--no-wait").option("--workspace <id>").option("--workspace-path <path>"))
    .action(async (session_id, options) => await execute_resource_command("session.send", { ...options, no_wait: options.wait === false }, { session_id }));
  common(session.command("stop <session_id>").option("--turn-id <id>"))
    .action(async (session_id, options) => await execute_resource_command("session.stop", options, { session_id }));
  common(session.command("archive <session_id>").option("--operation-id <uuid>", "Resume the original persisted archive plan").option("--root-storage-id <uuid>", "Expected immutable root record identity"))
    .action(async (session_id, options) => await execute_resource_command("session.archive", options, { session_id }));
}
