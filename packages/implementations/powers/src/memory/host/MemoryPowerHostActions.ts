/**
 * Memory Power 的宿主管理 actions。
 *
 * 关键点（中文）
 * - 界面不直接持有 Provider；所有读写都在界面显式选定的 Agent + Workspace
 *   执行范围里调用本 Power 的领域 action，因此权限判断与 Agent 调用完全一致。
 * - Agent / Workspace 列表由宿主作为只读能力注入，界面不猜测可用范围。
 * - 记忆的可读范围由访问上下文决定；界面只展示 Provider 返回的 Subject。
 */

import type {
  PowerJsonObject,
  PowerJsonValue,
  PowerLifecycleContext,
} from "@downcity/city/power";
import type {
  MemoryListResult,
  MemoryReadResult,
  MemoryRememberResult,
  MemoryForgetResult,
  MemoryReviseResult,
  MemoryStatusResult,
} from "@/memory/types/Memory.js";
import type { MemorySubject } from "@/memory/types/MemoryAccess.js";
import type {
  MemoryMainviewForgetInput,
  MemoryMainviewListItem,
  MemoryMainviewListInput,
  MemoryMainviewListResult,
  MemoryMainviewMutationResult,
  MemoryMainviewReadInput,
  MemoryMainviewReadResult,
  MemoryMainviewRememberInput,
  MemoryMainviewReviseInput,
  MemoryMainviewScopeInput,
  MemoryMainviewScopeKind,
  MemoryMainviewSnapshot,
} from "@/memory/types/MemoryMainview.js";

/** 界面默认枚举的条目数量。 */
const DEFAULT_LIST_LIMIT = 50;

/** 注册 Memory Power 的宿主管理 actions。 */
export function register_memory_power_host_actions(context: PowerLifecycleContext): void {
  context.power.action({
    id: "memory.snapshot",
    run: async (input) => as_json(await create_snapshot(context, read_scope(input))),
  });
  context.power.action({
    id: "memory.list",
    run: async (input) => as_json(await list_memories(context, read_list_input(input))),
  });
  context.power.action({
    id: "memory.read",
    run: async (input) => as_json(await read_memory(context, read_read_input(input))),
  });
  context.power.action({
    id: "memory.remember",
    run: async (input) => as_json(await remember_memory(context, read_remember_input(input))),
  });
  context.power.action({
    id: "memory.revise",
    run: async (input) => as_json(await revise_memory(context, read_revise_input(input))),
  });
  context.power.action({
    id: "memory.forget",
    run: async (input) => as_json(await forget_memory(context, read_forget_input(input))),
  });
}

/**
 * 创建 Memory 工作区快照。
 *
 * Provider 状态必须在一个真实执行范围上读取，因此这里优先使用界面选定的
 * Agent；没有可用范围时退化为静态能力描述，让界面仍能渲染空态。
 */
async function create_snapshot(
  context: PowerLifecycleContext,
  scope: MemoryMainviewScopeInput,
): Promise<MemoryMainviewSnapshot> {
  const [agents, workspaces] = await Promise.all([
    context.system.list_agents(),
    context.system.list_workspaces(),
  ]);
  const resolved_agent = agents.find((agent) => agent.agent_id === scope.agent_id) ?? agents[0];
  const resolved_workspace = workspaces.find(
    (workspace) => workspace.workspace_id === scope.workspace_id,
  ) ?? workspaces[0];
  const status = resolved_agent
    ? await read_status(context, resolved_agent.agent_id, resolved_workspace?.workspace_id)
    : undefined;
  const counts = resolved_agent
    ? await read_scope_counts(context, resolved_agent.agent_id, agents, resolved_workspace?.workspace_id)
    : undefined;
  return {
    agents: agents.map((agent) => ({
      agent_id: agent.agent_id,
      name: agent.name,
      ...(counts?.agents[agent.agent_id] === undefined
        ? {}
        : { memory_count: counts.agents[agent.agent_id] }),
    })),
    workspaces: workspaces.map((workspace) => ({
      workspace_id: workspace.workspace_id,
      name: workspace.name,
    })),
    status: {
      provider: status?.provider ?? "unknown",
      state: status?.state ?? "degraded",
      supports_list: status?.capabilities.list === true,
      city_memory_available: status?.details?.city_memory_available === true,
      ...(status?.details ? { details: status.details } : {}),
    },
    ...(counts?.city === undefined ? {} : { city_count: counts.city }),
  };
}

/**
 * 读取共享范围与每个 Agent 私有范围的条目数量。
 *
 * 关键点（中文）：计数只用于导航副标题，单个范围失败不能让整个快照失败；
 * 因此这里逐个吞掉错误并省略对应计数。共享计数借用一个真实 Agent 执行。
 */
async function read_scope_counts(
  context: PowerLifecycleContext,
  executor_agent_id: string,
  agents: readonly { readonly agent_id: string }[],
  workspace_id: string | undefined,
): Promise<{
  /** City 共享记忆条目数量。 */
  city: number | undefined;
  /** 按 Agent ID 索引的私有记忆条目数量。 */
  agents: Record<string, number | undefined>;
}> {
  const [city, ...agent_counts] = await Promise.all([
    count_scope(context, executor_agent_id, workspace_id, "city"),
    ...agents.map((agent) => count_scope(context, agent.agent_id, workspace_id, "agent")),
  ]);
  return {
    city,
    agents: Object.fromEntries(
      agents.map((agent, index) => [agent.agent_id, agent_counts[index]]),
    ),
  };
}

/** 统计一个执行范围内指定 Subject 的条目数量。 */
async function count_scope(
  context: PowerLifecycleContext,
  agent_id: string,
  workspace_id: string | undefined,
  subject_kind: MemoryMainviewScopeKind,
): Promise<number | undefined> {
  try {
    const result = await invoke_domain_action<MemoryListResult>(
      context,
      { scope: subject_kind, agent_id, workspace_id: workspace_id ?? "" },
      "list",
      { subject_kinds: [subject_kind], limit: 1 },
    );
    return result.total;
  } catch {
    return undefined;
  }
}

/** 枚举指定执行范围中的记忆。 */
async function list_memories(
  context: PowerLifecycleContext,
  input: MemoryMainviewListInput,
): Promise<MemoryMainviewListResult> {
  const result = await invoke_domain_action<MemoryListResult>(context, input, "list", {
    ...(input.subject_kinds ? { subject_kinds: input.subject_kinds } : {}),
    limit: input.limit ?? DEFAULT_LIST_LIMIT,
    ...(input.offset === undefined ? {} : { offset: input.offset }),
  });
  return to_list_result(result);
}

/** 读取一条记忆的完整正文。 */
async function read_memory(
  context: PowerLifecycleContext,
  input: MemoryMainviewReadInput,
): Promise<MemoryMainviewReadResult> {
  const result = await invoke_domain_action<MemoryReadResult>(context, input, "read", {
    memory_id: input.memory_id,
  });
  const memory = result.memory;
  if (!memory) {
    return { found: false, memory_id: result.memory_id, error: "记忆不存在或已被删除。" };
  }
  return {
    found: true,
    memory_id: memory.memory_id,
    content: memory.content,
    memory_type: memory.memory_type,
    title: read_memory_title(memory.memory_id, memory.metadata),
    subject: memory.subject as unknown as MemorySubject,
    observed_at: memory.observed_at,
    ...(memory.citation ? { citation: memory.citation } : {}),
    source_ids: memory.source_refs.map((reference) => reference.source_id),
  };
}

/** 返回一条记忆的展示名称。 */
function read_memory_title(memory_id: string, metadata: PowerJsonObject | undefined): string {
  const title = metadata?.title;
  if (typeof title === "string" && title.trim()) return title.trim();
  return memory_id.split("/").pop() || memory_id;
}

/** 写入一条记忆并返回刷新后的列表。 */
async function remember_memory(
  context: PowerLifecycleContext,
  input: MemoryMainviewRememberInput,
): Promise<MemoryMainviewMutationResult> {
  const result = await invoke_domain_action<MemoryRememberResult>(
    context,
    input,
    "remember",
    {
      content: input.content,
      target: input.target,
      ...(input.topic ? { topic: input.topic } : {}),
      ...(input.memory_type ? { memory_type: input.memory_type } : {}),
    },
  );
  return await mutation_result(context, input, result.memory_id, "记忆已保存。");
}

/** 修订一条记忆并返回刷新后的列表。 */
async function revise_memory(
  context: PowerLifecycleContext,
  input: MemoryMainviewReviseInput,
): Promise<MemoryMainviewMutationResult> {
  const result = await invoke_domain_action<MemoryReviseResult>(context, input, "revise", {
    memory_id: input.memory_id,
    instruction: input.instruction,
  });
  return await mutation_result(context, input, result.memory_id, "记忆已修订。");
}

/** 删除一条记忆并返回刷新后的列表。 */
async function forget_memory(
  context: PowerLifecycleContext,
  input: MemoryMainviewForgetInput,
): Promise<MemoryMainviewMutationResult> {
  const result = await invoke_domain_action<MemoryForgetResult>(context, input, "forget", {
    memory_id: input.memory_id,
  });
  const message = result.forgotten ? "记忆已删除。" : "该记忆已不存在。";
  return await mutation_result(context, input, result.memory_id, message);
}

/** 在指定执行范围读取 Provider 状态。 */
async function read_status(
  context: PowerLifecycleContext,
  agent_id: string,
  workspace_id: string | undefined,
): Promise<MemoryStatusResult | undefined> {
  const result = await context.system.invoke_agent_power({
    agent_id,
    workspace_id,
    power_id: context.power.id,
    action_id: "status",
    input: {},
  }) as unknown as { success?: boolean; data?: MemoryStatusResult };
  return result?.success === true ? result.data : undefined;
}

/**
 * 在界面选定的执行范围里调用本 Power 的领域 action。
 *
 * 关键点（中文）：领域 action 必须绑定一个真实 Agent，即使要读的是 City 共享记忆；
 * 因此 `agent_id` 缺失时回退到第一个可用 Agent，而不是拒绝请求。领域 action 已经
 * 声明 `access` 与输入 schema；这里只负责把执行范围交给 City，并把稳定失败结果还原
 * 为异常，避免界面把失败当成空数据。
 */
async function invoke_domain_action<TResult>(
  context: PowerLifecycleContext,
  scope: MemoryMainviewScopeInput,
  action_id: string,
  input: PowerJsonObject,
): Promise<TResult> {
  const agents = await context.system.list_agents();
  const agent = agents.find((item) => item.agent_id === scope.agent_id) ?? agents[0];
  if (!agent) throw new Error("Memory requires at least one Agent as execution context");
  const workspaces = await context.system.list_workspaces();
  const workspace = workspaces.find((item) => item.workspace_id === scope.workspace_id)
    ?? workspaces[0];
  if (scope.workspace_id && !workspaces.some((item) => item.workspace_id === scope.workspace_id)) {
    throw new Error("Selected Memory Workspace was not found");
  }
  if (action_id === "remember" && input.target === "current_workspace" && !workspace) {
    throw new Error("Workspace memory requires a Workspace");
  }
  const result = await context.system.invoke_agent_power({
    agent_id: agent.agent_id,
    ...(workspace ? { workspace_id: workspace.workspace_id } : {}),
    power_id: context.power.id,
    action_id,
    input,
  }) as unknown as { success?: boolean; data?: TResult; error?: string; message?: string };
  if (result?.success !== true) {
    throw new Error(result?.error || result?.message || `Memory action failed: ${action_id}`);
  }
  return result.data as TResult;
}

/** 写操作成功后附带刷新后的列表，避免界面自行推断状态。 */
async function mutation_result(
  context: PowerLifecycleContext,
  scope: MemoryMainviewScopeInput,
  memory_id: string,
  message: string,
): Promise<MemoryMainviewMutationResult> {
  const listed = await list_memories(context, {
    scope: scope.scope,
    agent_id: scope.agent_id,
    workspace_id: scope.workspace_id,
    subject_kinds: [scope.scope],
  });
  return {
    ...listed,
    operation_success: true,
    message,
    memory_id,
  };
}

/** 把 Provider 枚举结果投影为界面协议。 */
function to_list_result(result: MemoryListResult): MemoryMainviewListResult {
  return {
    items: result.items.map((item): MemoryMainviewListItem => ({
      memory_id: item.memory_id,
      memory_type: item.memory_type,
      subject: item.subject as unknown as MemorySubject,
      title: item.title,
      snippet: item.snippet,
      observed_at: item.observed_at,
      is_evidence: item.is_evidence,
      ...(item.citation ? { citation: item.citation } : {}),
    })),
    total: result.total,
  };
}

/** 读取必填执行范围。 */
function read_scope(input: PowerJsonValue | undefined): MemoryMainviewScopeInput {
  const source = read_record(input);
  return {
    scope: read_scope_kind(source),
    agent_id: read_optional_string(source, "agent_id"),
    workspace_id: read_optional_string(source, "workspace_id"),
  };
}

/** 读取记忆范围类别；未声明时默认查看 Agent 私有记忆。 */
function read_scope_kind(source: Record<string, PowerJsonValue>): MemoryMainviewScopeKind {
  return read_optional_string(source, "scope") === "city" ? "city" : "agent";
}

/** 解析枚举输入；Subject 过滤完全由范围类别决定。 */
function read_list_input(input: PowerJsonValue | undefined): MemoryMainviewListInput {
  const source = read_record(input);
  const scope = read_scope(input);
  return {
    ...scope,
    subject_kinds: [scope.scope],
    ...(typeof source.limit === "number" ? { limit: source.limit } : {}),
    ...(typeof source.offset === "number" ? { offset: source.offset } : {}),
  };
}

/** 解析读取输入。 */
function read_read_input(input: PowerJsonValue | undefined): MemoryMainviewReadInput {
  const source = read_record(input);
  return { ...read_scope(input), memory_id: read_required_string(source, "memory_id") };
}

/** 解析写入输入。 */
function read_remember_input(input: PowerJsonValue | undefined): MemoryMainviewRememberInput {
  const source = read_record(input);
  const topic = read_optional_string(source, "topic");
  const memory_type = read_optional_string(source, "memory_type");
  return {
    ...read_scope(input),
    content: read_required_string(source, "content"),
    target: read_required_string(source, "target"),
    ...(topic ? { topic } : {}),
    ...(memory_type ? { memory_type } : {}),
  };
}

/** 解析修订输入。 */
function read_revise_input(input: PowerJsonValue | undefined): MemoryMainviewReviseInput {
  const source = read_record(input);
  return {
    ...read_scope(input),
    memory_id: read_required_string(source, "memory_id"),
    instruction: read_required_string(source, "instruction"),
  };
}

/** 解析删除输入。 */
function read_forget_input(input: PowerJsonValue | undefined): MemoryMainviewForgetInput {
  const source = read_record(input);
  return { ...read_scope(input), memory_id: read_required_string(source, "memory_id") };
}

/** 读取可选 Subject 类别过滤条件。 */
function read_subject_kinds(
  source: Record<string, PowerJsonValue>,
): string[] | undefined {
  if (!Array.isArray(source.subject_kinds)) return undefined;
  const allowed = ["agent", "city"];
  const kinds = source.subject_kinds
    .filter((value): value is string => typeof value === "string")
    .filter((value) => allowed.includes(value));
  return kinds.length > 0 ? kinds : undefined;
}

/** 要求输入是一个 Power JSON object。 */
function read_record(value: PowerJsonValue | undefined): Record<string, PowerJsonValue> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Memory host action input must be an object");
  }
  return value;
}

/** 读取对象中的必填字符串。 */
function read_required_string(
  source: Record<string, PowerJsonValue>,
  key: string,
): string {
  const value = read_optional_string(source, key);
  if (!value) throw new Error(`${key} is required`);
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
