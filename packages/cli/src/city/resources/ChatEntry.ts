/** chat 入口目标解析；已有 Session 使用持久化目录，路径只定位已登记项目。 */
import fs from "node:fs/promises";
import prompts from "../tui/Prompts.js";
import { ResourceClient } from "./ResourceClient.js";
import type { WorkspaceListData, SessionListData, SessionGetData, SessionCreateData } from "./ResourceResults.js";
import { ResourceError } from "@downcity/city/local";

/** 共用 create/resolve 输入，命令和 TUI 均保持完整资源地址。 */
export interface ChatEntryInput {
  /** 完整 Agent ID。 */
  agent: string;
  /** 会话来源分类，默认 work。 */
  category?: string;
  /** 已有完整 Session ID，与 new_session 互斥。 */
  session_id?: string;
  /** 显式创建新的普通工作会话。 */
  new_session?: boolean;
  /** 稳定项目 ID。 */
  workspace?: string;
  /** 已登记项目真实路径，与 workspace 互斥。 */
  workspace_path?: string;
  /** 仅真实终端允许 cwd/项目选择与最近会话便利行为。 */
  interactive: boolean;
}

/** 不恢复 executor 的目标解析；只有明确创建请求才调用在线 create。 */
export async function resolve_chat_entry(client: ResourceClient, input: ChatEntryInput) {
  const category = input.category ?? "work";
  if (!["work", "chat"].includes(category)) throw new ResourceError("usage_error", "category must be chat or work", 2);
  if (input.session_id && input.new_session) throw new ResourceError("usage_error", "session-id and new-session are mutually exclusive", 2);
  if (input.workspace && input.workspace_path) throw new ResourceError("usage_error", "workspace and workspace-path are mutually exclusive", 2);
  const result = await client.call("workspace.list");
  const workspaces = (result.data as WorkspaceListData).items.filter((item) => item.registered);
  let workspace_id = input.workspace;
  if (input.workspace_path) {
    const real_path = await fs.realpath(input.workspace_path);
    workspace_id = workspaces.find((item) => item.workspace_path === real_path)?.workspace_id;
    if (!workspace_id) throw new ResourceError("workspace_missing", "Workspace path is not registered", 4);
  }
  let session_id = input.session_id;
  if (!session_id && !input.new_session) {
    if (!input.interactive) throw new ResourceError("usage_error", "Non-interactive chat requires session-id or new-session with an explicit Workspace", 2);
    const page = await client.call("session.list", { agent: input.agent, category, ...(workspace_id ? { workspace: workspace_id } : {}), limit: 1 });
    session_id = (page.data as SessionListData).items[0]?.session_id;
  }
  if (session_id) {
    const result = await client.call("session.get", { agent: input.agent, category, session_id });
    const session = (result.data as SessionGetData).session;
    if (session.archived) throw new ResourceError("dependency_conflict", "Archived history cannot execute", 4);
    if (workspace_id && workspace_id !== session.workspace_id) throw new ResourceError("dependency_conflict", "Workspace does not match the persisted Session directory", 4);
    workspace_id = session.workspace_id ?? undefined;
  } else {
    if (category !== "work") throw new ResourceError("capability_missing", "Ordinary Session creation uses category work; select an existing chat Session", 5);
    if (!workspace_id && input.interactive) {
      const cwd = await fs.realpath(process.cwd());
      workspace_id = workspaces.find((item) => item.workspace_path === cwd)?.workspace_id;
      if (!workspace_id) { const selected = await prompts({ type: "select", name: "workspace", message: "Workspace", choices: workspaces.map((item) => ({ title: `${item.name} · ${item.workspace_id}`, value: item.workspace_id })) }); workspace_id = typeof selected.workspace === "string" ? selected.workspace : undefined; }
    }
    if (!workspace_id) throw new ResourceError("usage_error", "An explicit registered Workspace is required", 2);
    const created = await client.call("session.create", { agent: input.agent, workspace: workspace_id });
    session_id = (created.data as SessionCreateData).session.session_id;
  }
  const workspace = workspaces.find((item) => item.workspace_id === workspace_id);
  if (!workspace) throw new ResourceError("workspace_missing", "Session Workspace is not registered; history remains available", 4);
  return { agent_id: input.agent, category, session_id, workspace_id: workspace.workspace_id, project_root: workspace.workspace_path! };
}
