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
  type?: string;
  /** 创建用途或最近会话过滤；普通工作默认 work。 */
  kind?: string;
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
  const type = input.type ?? "work";
  let kind = input.kind?.trim() ?? (type === "work" ? "work" : undefined);
  if (kind === "") throw new ResourceError("usage_error", "kind must be a non-empty string", 2);
  if (!["work", "chat"].includes(type)) throw new ResourceError("usage_error", "type must be chat or work", 2);
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
    const page = await client.call("session.list", { agent: input.agent, type, kind, ...(workspace_id ? { workspace: workspace_id } : {}), limit: 1 });
    session_id = (page.data as SessionListData).items[0]?.id;
  }
  if (session_id) {
    const result = await client.call("session.get", { agent: input.agent, type, session_id });
    const session = (result.data as SessionGetData).session;
    if (session.archived) throw new ResourceError("dependency_conflict", "Archived history cannot execute", 4);
    if (workspace_id && workspace_id !== session.workspace_id) throw new ResourceError("dependency_conflict", "Workspace does not match the persisted Session directory", 4);
    workspace_id = session.workspace_id ?? undefined;
    kind = session.kind;
  } else {
    if (type !== "work") throw new ResourceError("capability_missing", "Ordinary Session creation uses type work; select an existing chat Session", 5);
    if (!workspace_id && input.interactive) {
      const cwd = await fs.realpath(process.cwd());
      workspace_id = workspaces.find((item) => item.workspace_path === cwd)?.workspace_id;
      if (!workspace_id) { const selected = await prompts({ type: "select", name: "workspace", message: "Workspace", choices: workspaces.map((item) => ({ title: `${item.name} · ${item.workspace_id}`, value: item.workspace_id })) }); workspace_id = typeof selected.workspace === "string" ? selected.workspace : undefined; }
    }
    if (!workspace_id) throw new ResourceError("usage_error", "An explicit registered Workspace is required", 2);
    const created = await client.call("session.create", { agent: input.agent, workspace: workspace_id, type, kind });
    session_id = (created.data as SessionCreateData).session.id;
  }
  if (!session_id) throw new ResourceError("internal_error", "Resolved Session response has no ID", 1);
  const workspace = workspaces.find((item) => item.workspace_id === workspace_id);
  if (!workspace) throw new ResourceError("workspace_missing", "Session Workspace is not registered; history remains available", 4);
  return { agent_id: input.agent, type, kind, session_id, workspace_id: workspace.workspace_id, project_root: workspace.workspace_path! };
}
