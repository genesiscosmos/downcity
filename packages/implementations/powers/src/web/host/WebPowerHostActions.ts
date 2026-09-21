/**
 * Web Power 的宿主管理 actions。
 *
 * 关键点（中文）
 * - 界面是只读状态页：只读取 Provider 解析结果、配置摘要与当前浏览器会话。
 * - 所有事实都通过本 Power 的领域 action 在指定 Agent + Workspace 上取得，
 *   因此界面看到的可用性与 Agent 实际执行时完全一致。
 * - 本模块不返回任何 API Key；密钥仍由 Config 面板写入。
 */

import type {
  PowerHostAgent,
  PowerHostWorkspace,
  PowerJsonValue,
  PowerLifecycleContext,
} from "@downcity/city/power";
import type {
  BrowserListSessionsResult,
  WebPowerStatusResult,
} from "@/web/types/WebPower.js";
import { public_config } from "@/web/host/WebPowerConfigActions.js";
import type {
  WebMainviewCapabilityStatus,
  WebMainviewSessionsInput,
  WebMainviewSessionsResult,
  WebMainviewSnapshot,
  WebMainviewSnapshotInput,
} from "@/web/types/WebMainview.js";

/** 注册 Web Power 的宿主只读 actions。 */
export function register_web_power_host_actions(context: PowerLifecycleContext): void {
  context.power.action({
    id: "web.snapshot",
    run: async (input) => as_json(await create_snapshot(context, read_snapshot_input(input))),
  });
  context.power.action({
    id: "web.sessions",
    run: async (input) => as_json(await list_sessions(context, read_sessions_input(input))),
  });
}

/** 创建 Web 状态页所需的只读快照。 */
async function create_snapshot(
  context: PowerLifecycleContext,
  input: WebMainviewSnapshotInput,
): Promise<WebMainviewSnapshot> {
  const [agents, workspaces] = await Promise.all([
    context.system.list_agents(),
    context.system.list_workspaces(),
  ]);
  const scope = resolve_scope(agents, workspaces, input);
  const status = scope
    ? await invoke_domain_action<WebPowerStatusResult>(context, scope, "status")
    : undefined;
  return {
    agents: agents.map((agent) => ({ agent_id: agent.agent_id, name: agent.name })),
    workspaces: workspaces.map((workspace) => ({
      workspace_id: workspace.workspace_id,
      name: workspace.name,
    })),
    config: public_config(context.config.get()),
    search: capability_status("search", status?.search_provider ?? "", status),
    document: capability_status("document", status?.document_provider ?? "", status),
    browser: capability_status("browser", status?.browser_provider ?? "", status),
    browser_provider: status?.browser_provider ?? "",
    warnings: status?.reasons ?? ["请先创建一个 Agent 和 Workspace，才能解析当前 Web 能力。"],
  };
}

/** 列出当前浏览器 Provider 拥有的会话。 */
async function list_sessions(
  context: PowerLifecycleContext,
  input: WebMainviewSessionsInput,
): Promise<WebMainviewSessionsResult> {
  const [agents, workspaces] = await Promise.all([
    context.system.list_agents(),
    context.system.list_workspaces(),
  ]);
  const scope = resolve_scope(agents, workspaces, input);
  if (!scope) {
    return { available: false, sessions: [], note: "请先创建一个 Agent 和 Workspace。" };
  }
  const status = await invoke_domain_action<WebPowerStatusResult>(context, scope, "status");
  if (!status.browser_provider) {
    return { available: false, sessions: [], note: "浏览器能力当前已关闭或未配置。" };
  }
  const result = await invoke_domain_action<BrowserListSessionsResult>(
    context,
    scope,
    "browser_list_sessions",
  );
  return {
    available: true,
    sessions: result.sessions.map((session) => ({
      session_id: session.session_id,
      url: session.url,
      title: session.title,
      observation_generation: session.observation_generation,
    })),
    note: result.sessions.length === 0 ? "当前没有活跃的浏览器会话。" : "",
  };
}

/**
 * 解析实际使用的执行范围。
 *
 * 界面首次打开时 route 可能还是空的，此时回退到宿主登记的第一个 Agent 与
 * Workspace；两者缺一时返回空，让界面展示明确空态而不是抛错。
 */
function resolve_scope(
  agents: readonly PowerHostAgent[],
  workspaces: readonly PowerHostWorkspace[],
  input: { readonly agent_id: string; readonly workspace_id: string },
): { agent_id: string; workspace_id: string } | undefined {
  const agent = agents.find((item) => item.agent_id === input.agent_id) ?? agents[0];
  const workspace = workspaces.find((item) => item.workspace_id === input.workspace_id)
    ?? workspaces[0];
  if (!agent || !workspace) return undefined;
  return { agent_id: agent.agent_id, workspace_id: workspace.workspace_id };
}

/** 把领域状态投影为一个能力区说明。 */
function capability_status(
  kind: "search" | "document" | "browser",
  provider: string,
  status: WebPowerStatusResult | undefined,
): WebMainviewCapabilityStatus {
  if (provider) {
    return {
      provider,
      available: true,
      selection: provider,
      note: "",
    };
  }
  return {
    provider: "",
    available: false,
    selection: kind === "browser" ? "已关闭" : "未配置",
    note: status?.reasons[0] || unavailable_note(kind),
  };
}

/** 返回各能力区不可用时的默认说明。 */
function unavailable_note(kind: "search" | "document" | "browser"): string {
  if (kind === "search") return "在设置中配置 Tavily 或 Exa API Key 后启用搜索。";
  if (kind === "document") return "网页读取当前已关闭。";
  return "浏览器 Provider 当前已关闭。";
}

/**
 * 在指定执行范围里调用本 Power 的领域 action。
 *
 * 领域 action 自己解析当前配置与环境变量；宿主只负责提供 Agent 与 Workspace，
 * 因此界面不会看到与 Agent 执行不同的可用性。
 */
async function invoke_domain_action<TResult>(
  context: PowerLifecycleContext,
  scope: { readonly agent_id: string; readonly workspace_id: string },
  action_id: string,
): Promise<TResult> {
  const agent = (await context.system.list_agents())
    .find((item) => item.agent_id === scope.agent_id);
  if (!agent) throw new Error(`Agent not found: ${scope.agent_id}`);
  const workspace = (await context.system.list_workspaces())
    .find((item) => item.workspace_id === scope.workspace_id);
  if (!workspace) throw new Error(`Workspace not found: ${scope.workspace_id}`);
  const result = await context.system.invoke_agent_power({
    agent_id: agent.agent_id,
    workspace_id: workspace.workspace_id,
    power_id: context.power.id,
    action_id,
    input: {},
  }) as unknown as { success?: boolean; data?: TResult; error?: string; message?: string };
  if (result?.success !== true) {
    throw new Error(result?.error || result?.message || `Web action failed: ${action_id}`);
  }
  return result.data as TResult;
}

/** 读取必填执行范围。 */
function read_scope(input: PowerJsonValue | undefined): {
  agent_id: string;
  workspace_id: string;
} {
  const source = read_record(input);
  return {
    agent_id: read_optional_string(source, "agent_id"),
    workspace_id: read_optional_string(source, "workspace_id"),
  };
}

/** 解析快照输入。 */
function read_snapshot_input(input: PowerJsonValue | undefined): WebMainviewSnapshotInput {
  return read_scope(input);
}

/** 解析会话列表输入。 */
function read_sessions_input(input: PowerJsonValue | undefined): WebMainviewSessionsInput {
  return read_scope(input);
}

/** 要求输入是一个 Power JSON object。 */
function read_record(value: PowerJsonValue | undefined): Record<string, PowerJsonValue> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Web host action input must be an object");
  }
  return value;
}

/** 读取对象中经过裁剪的可选字符串。 */
function read_optional_string(
  source: Record<string, PowerJsonValue>,
  key: string,
): string {
  const value = source[key];
  return typeof value === "string" ? value.trim() : "";
}

/** 把结构化协议显式收敛到 Power JSON 边界。 */
function as_json(value: unknown): PowerJsonValue {
  return value as PowerJsonValue;
}
