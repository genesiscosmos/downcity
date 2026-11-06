/** TUI 资源表单与导航；只收集稳定 ID 和输入，全部业务调用 ResourceClient。 */
import prompts from "../tui/Prompts.js";
import { ResourceClient } from "./ResourceClient.js";
import { inspect } from "node:util";

/** 创建独立 Agent 身份，不登记 cwd 或安装项目资产。 */
export async function create_agent_tui(): Promise<void> {
  const input = await prompts([{ type: "text", name: "name", message: "Agent name" }, { type: "text", name: "description", message: "Description" }, { type: "text", name: "model", message: "Default model ID (optional)" }]);
  if (!input.name) return;
  await new ResourceClient().call("agent.create", { name: input.name, description: input.description ?? "", ...(input.model ? { model: input.model } : {}) });
}

/** 项目登记/改名/移除与会话浏览管理，共用显式命令相同的用例结果。 */
export async function manage_resources_tui(): Promise<void> {
  const client = new ResourceClient();
  while (true) {
    const selection = await prompts({ type: "select", name: "action", message: "Resources", choices: [
      { title: "Register Workspace", value: "register" }, { title: "Workspaces", value: "workspaces" },
      { title: "Agent configuration / deletion", value: "agents" }, { title: "Sessions / history", value: "sessions" }, { title: "Back", value: "back" },
    ] });
    if (!selection.action || selection.action === "back") return;
    try {
      if (selection.action === "register") {
        const input = await prompts([{ type: "text", name: "path", message: "Existing project directory" }, { type: "text", name: "name", message: "Display name (optional)" }]);
        if (input.path) await client.call("workspace.register", { path: input.path, ...(input.name ? { name: input.name } : {}) });
      } else if (selection.action === "workspaces") {
        const result = await client.call("workspace.list");
        const items = (result.data as { items: { workspace_id: string; name: string; workspace_path: string }[] }).items;
        const choice = await prompts({ type: "select", name: "id", message: "Workspace", choices: items.map((item) => ({ title: `${item.name} · ${item.workspace_id}`, description: item.workspace_path, value: item.workspace_id })) });
        if (!choice.id) continue;
        const action = await prompts({ type: "select", name: "value", message: String(choice.id), choices: [{ title: "Details", value: "get" }, { title: "Rename", value: "update" }, { title: "Remove registration (retain project and history)", value: "remove" }] });
        if (action.value === "get") await show_result((await client.call("workspace.get", { id: choice.id })).data);
        if (action.value === "update") { const input = await prompts({ type: "text", name: "name", message: "Name" }); if (input.name) await client.call("workspace.update", { id: choice.id, name: input.name }); }
        if (action.value === "remove" && await confirm_action("Remove registration and release idle resources? Project files and history are retained.")) await client.call("workspace.remove", { id: choice.id });
      } else {
        const result = await client.call("agent.list");
        const items = (result.data as { items: { agent_id: string; name: string }[] }).items;
        const choice = await prompts({ type: "select", name: "id", message: "Agent", choices: items.map((item) => ({ title: `${item.name} · ${item.agent_id}`, value: item.agent_id })) });
        if (!choice.id) continue;
        if (selection.action === "agents") {
          const action = await prompts({ type: "select", name: "value", message: String(choice.id), choices: [{ title: "Details", value: "get" }, { title: "Rename", value: "name" }, { title: "Default model", value: "model" }, { title: "Permanent deletion", value: "delete" }] });
          if (action.value === "get") await show_result((await client.call("agent.get", { id: choice.id })).data);
          if (["name", "model"].includes(String(action.value))) { const input = await prompts({ type: "text", name: "value", message: String(action.value) }); if (input.value) await client.call("agent.update", { id: choice.id, [String(action.value)]: input.value }); }
          if (action.value === "delete" && await confirm_action("Permanently delete Agent configuration, Sessions, archives, attachments, skills, logs and owned Power data?")) await client.call("agent.delete", { id: choice.id });
        } else await sessions_tui(client, String(choice.id));
      }
    } catch (error) { await show_result(error instanceof Error ? error.message : String(error)); }
  }
}

/** 会话列表仅把完整地址交给用例，不注入 Workspace。 */
async function sessions_tui(client: ResourceClient, agent: string): Promise<void> {
  const scope = await prompts([{ type: "select", name: "category", message: "Category", choices: [{ title: "Work", value: "work" }, { title: "Chat", value: "chat" }] }, { type: "confirm", name: "archived", message: "Archived history?", initial: false }]);
  if (!scope.category) return;
  const result = await client.call("session.list", { agent, ...scope });
  const page = result.data as { items: { session_id: string; title: string | null }[]; next_cursor: string | null };
  const selected = await prompts({ type: "select", name: "id", message: "Session", choices: page.items.map((item) => ({ title: `${item.title ?? item.session_id} · ${item.session_id}`, value: item.session_id })) });
  if (!selected.id) return;
  const input = { agent, category: scope.category, session_id: selected.id };
  const action = await prompts({ type: "select", name: "value", message: String(selected.id), choices: [{ title: "Details", value: "get" }, { title: "History", value: "history" }, { title: "Stop current Turn", value: "stop" }, { title: "Archive", value: "archive" }] });
  if (action.value) await show_result((await client.call(`session.${action.value}`, input)).data);
}

/** 确认属于展示层，用例不读取终端。 */
async function confirm_action(message: string): Promise<boolean> { return (await prompts({ type: "confirm", name: "yes", message, initial: false })).yes === true; }

/** 暂停展示结果，避免管理循环立即覆盖用户需要的信息。 */
async function show_result(data: unknown): Promise<void> {
  process.stdout.write(`${inspect(data, { colors: true, depth: 6 })}\n`);
  await prompts({ type: "confirm", name: "continue", message: "Continue", initial: true });
}
