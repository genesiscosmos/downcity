/** chat 命令展示适配；一次性消息复用 session.send 的 JSON/退出码与等待契约。 */
import { ResourceClient } from "./ResourceClient.js";
import { resolve_chat_entry } from "./ChatEntry.js";
import { execute_resource_command, resource_input, prepare_resource_input } from "./ResourceOutput.js";
import { as_resource_error, ResourceError } from "@downcity/city/local";
import { chatCommand } from "../agent/AgentChat.js";

/** 显式命令完整 Agent ID；TTY 的 Agent 选择由裸 city 管理界面提供。 */
export async function run_resource_chat(agent_id: string, options: Record<string, unknown>): Promise<void> {
  const input = resource_input(options);
  const client = new ResourceClient({ root: typeof input.root === "string" ? input.root : undefined });
  try {
    await prepare_resource_input(input);
    if (input.message !== undefined) {
      const target = await resolve_chat_entry(client, { agent: agent_id, type: typeof input.type === "string" ? input.type : undefined, kind: typeof input.kind === "string" ? input.kind : undefined, session_id: typeof input.session_id === "string" ? input.session_id : undefined, new_session: input.new_session === true, workspace: typeof input.workspace === "string" ? input.workspace : undefined, workspace_path: typeof input.workspace_path === "string" ? input.workspace_path : undefined, interactive: !input.json && process.stdin.isTTY === true && process.stdout.isTTY === true });
      await execute_resource_command("session.send", { ...options, messageFile: undefined, no_wait: options.wait === false }, { ...input, agent: agent_id, type: target.type, session_id: target.session_id, no_wait: options.wait === false });
      return;
    }
    if (input.json || !process.stdin.isTTY || !process.stdout.isTTY) throw new ResourceError("usage_error", "Interactive chat requires a TTY; use message or message-file for a one-shot send", 2);
    await chatCommand({ to: agent_id, root: typeof input.root === "string" ? input.root : undefined, workspace: typeof input.workspace === "string" ? input.workspace : undefined, workspace_path: typeof input.workspace_path === "string" ? input.workspace_path : undefined, type: typeof input.type === "string" ? input.type : undefined, kind: typeof input.kind === "string" ? input.kind : undefined, session_id: typeof input.session_id === "string" ? input.session_id : undefined, newSession: input.new_session === true });
  } catch (error) {
    const failure = as_resource_error(error);
    process.exitCode = failure.exit_code;
    if (input.json) process.stdout.write(`${JSON.stringify({ schema_version: 1, success: false, command: "agent.chat", data: null, error: { code: failure.code, message: failure.message, retryable: failure.retryable, details: failure.details }, meta: { root_path: client.root_path, host: null, source: "local", observed_at: new Date().toISOString() } })}\n`);
    else process.stderr.write(`${failure.code}: ${failure.message}\n`);
  }
}
