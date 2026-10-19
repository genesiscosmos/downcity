/**
 * Web Power 的宿主管理 actions。
 *
 * 关键点（中文）
 * - 配置是 Power 级的单一存储，与 Agent / Workspace 无关，因此这些 action 不接收执行范围。
 * - 状态视图只读取 Provider 解析结果与当前浏览器会话；密钥写入属于 `web.config.*`。
 * - 解析可用性需要一个真实执行范围（Workspace env 可能提供 API Key），因此内部自动选用
 *   宿主登记的第一个 Agent 与 Workspace；没有范围时只返回配置，不报错。
 * - 本模块不返回任何 API Key。
 */

import type { PowerJsonValue, PowerLifecycleContext } from "@downcity/city/power";
import type {
  BrowserListSessionsResult,
  WebPowerStatusResult,
} from "@/web/types/WebPower.js";
import { public_config } from "@/web/host/WebPowerConfigActions.js";
import type {
  WebMainviewCapabilityStatus,
  WebMainviewSessionsResult,
  WebMainviewSnapshot,
} from "@/web/types/WebMainview.js";

/** 一次解析所用的执行范围。 */
interface ResolvedScope {
  /** 用于解析的 Agent 稳定 ID。 */
  readonly agent_id: string;
  /** 用于解析的 Workspace 稳定 ID。 */
  readonly workspace_id: string;
}

/** 注册 Web Power 的状态 actions。 */
export function register_web_power_host_actions(context: PowerLifecycleContext): void {
  context.power.action({
    id: "web.snapshot",
    run: async () => as_json(await create_snapshot(context)),
  });
  context.power.action({
    id: "web.sessions",
    run: async () => as_json(await list_sessions(context)),
  });
}

/**
 * 创建 Web 状态视图所需的快照。
 *
 * 配置始终可读；能力状态是尽力而为的：宿主还没有 Agent 或 Workspace 时，环境变量无法解析，
 * 此时把能力标记为未知并给出说明，而不是让整个页面失败。
 */
async function create_snapshot(context: PowerLifecycleContext): Promise<WebMainviewSnapshot> {
  const scope = await resolve_first_scope(context);
  const status = scope
    ? await invoke_domain_action<WebPowerStatusResult>(context, scope, "status")
    : undefined;
  return {
    config: public_config(context.config.get()),
    config_path: context.config.path,
    search: capability_status("search", status?.search_provider ?? "", status),
    document: capability_status("document", status?.document_provider ?? "", status),
    browser: capability_status("browser", status?.browser_provider ?? "", status),
    warnings: scope
      ? status?.reasons ?? []
      : ["尚未创建 Agent 与 Workspace，能力状态暂按当前配置展示。"],
  };
}

/** 列出当前浏览器 Provider 拥有的会话。 */
async function list_sessions(context: PowerLifecycleContext): Promise<WebMainviewSessionsResult> {
  const scope = await resolve_first_scope(context);
  if (!scope) {
    return { available: false, sessions: [], note: "尚未创建 Agent 与 Workspace。" };
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
 * 取宿主登记的第一个 Agent 与 Workspace 作为解析范围。
 *
 * 两者缺一就返回空：没有执行范围时不能凭空推断可用性，也不能因此抛错。
 */
async function resolve_first_scope(
  context: PowerLifecycleContext,
): Promise<ResolvedScope | undefined> {
  const [agents, workspaces] = await Promise.all([
    context.system.list_agents(),
    context.system.list_workspaces(),
  ]);
  const agent = agents[0];
  const workspace = workspaces[0];
  if (!agent || !workspace) return undefined;
  return { agent_id: agent.agent_id, workspace_id: workspace.workspace_id };
}

/**
 * 在指定执行范围里调用本 Power 的领域 action。
 *
 * 领域 action 自己解析当前配置与环境变量；宿主只负责提供 Agent 与 Workspace，
 * 因此界面不会看到与 Agent 执行不同的可用性。
 */
async function invoke_domain_action<TResult>(
  context: PowerLifecycleContext,
  scope: ResolvedScope,
  action_id: string,
): Promise<TResult> {
  const result = await context.system.invoke_agent_power({
    agent_id: scope.agent_id,
    workspace_id: scope.workspace_id,
    power_id: context.power.id,
    action_id,
    input: {},
  }) as unknown as { success?: boolean; data?: TResult; error?: string; message?: string };
  if (result?.success !== true) {
    throw new Error(result?.error || result?.message || `Web action failed: ${action_id}`);
  }
  return result.data as TResult;
}

/** 把领域状态投影为一个能力区说明。 */
function capability_status(
  kind: "search" | "document" | "browser",
  provider: string,
  status: WebPowerStatusResult | undefined,
): WebMainviewCapabilityStatus {
  if (provider) {
    return { provider, available: true, note: "" };
  }
  return {
    provider: "",
    available: false,
    note: status?.reasons[0] || unavailable_note(kind),
  };
}

/** 返回各能力区不可用时的默认说明。 */
function unavailable_note(kind: "search" | "document" | "browser"): string {
  if (kind === "search") return "配置 Tavily、Exa 或 DeepSeek API Key 后启用搜索。";
  if (kind === "document") return "网页读取当前已关闭。";
  return "浏览器 Provider 当前已关闭。";
}

/** 把结构化协议显式收敛到 Power JSON 边界。 */
function as_json(value: unknown): PowerJsonValue {
  return value as PowerJsonValue;
}
