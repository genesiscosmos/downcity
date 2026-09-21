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
  MemoryRecallItem,
  MemoryRecallResult,
  MemoryRememberResult,
  MemoryForgetResult,
  MemoryReviseResult,
  MemoryStatusResult,
} from "@/memory/types/Memory.js";
import type { MemorySubject, MemorySubjectKind } from "@/memory/types/MemoryAccess.js";
import type {
  MemoryMainviewForgetInput,
  MemoryMainviewListItem,
  MemoryMainviewListInput,
  MemoryMainviewListResult,
  MemoryMainviewMutationResult,
  MemoryMainviewReadInput,
  MemoryMainviewReadResult,
  MemoryMainviewRecallInput,
  MemoryMainviewRememberInput,
  MemoryMainviewReviseInput,
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
    id: "memory.recall",
    run: async (input) => as_json(await recall_memories(context, read_recall_input(input))),
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
  const status = resolved_agent && resolved_workspace
    ? await read_status(context, resolved_agent.agent_id, resolved_workspace.workspace_id)
    : undefined;
  return {
    agents: agents.map((agent) => ({ agent_id: agent.agent_id, name: agent.name })),
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
  };
}

/** 枚举指定执行范围中的记忆。 */
async function list_memories(
  context: PowerLifecycleContext,
  input: MemoryMainviewListInput,
): Promise<MemoryMainviewListResult> {
  const result = await invoke_domain_action<MemoryListResult>(context, input, "list", {
    ...(input.subject_kinds ? { subject_kinds: input.subject_kinds } : {}),
    ...(input.memory_types ? { memory_types: input.memory_types } : {}),
    ...(input.include_evidence === undefined ? {} : { include_evidence: input.include_evidence }),
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
      ...(input.source ? { source: input.source } : {}),
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
    ...(input.evidence ? { evidence: input.evidence } : {}),
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

/** 按关键词召回指定执行范围中的记忆。 */
async function recall_memories(
  context: PowerLifecycleContext,
  input: MemoryMainviewRecallInput,
): Promise<MemoryMainviewListResult> {
  const result = await invoke_domain_action<MemoryRecallResult>(context, input, "search", {
    query: input.query,
    max_results: input.max_results ?? DEFAULT_LIST_LIMIT,
    include_evidence: input.include_evidence === true,
  });
  return {
    items: result.items.map((item) => ({
      memory_id: item.memory.memory_id,
      memory_type: item.memory.memory_type,
      subject: item.memory.subject as unknown as MemorySubject,
      title: recall_title(item),
      snippet: item.snippet,
      observed_at: item.memory.observed_at,
      is_evidence: item.memory.memory_id.includes("/evidence/"),
      ...(item.memory.citation ? { citation: item.memory.citation } : {}),
    })),
    total: result.items.length,
    subject_counts: count_subjects(result.items.map((item) => item.memory.subject.kind)),
  };
}

/** 返回召回结果的展示名称。 */
function recall_title(item: MemoryRecallItem): string {
  const title = item.memory.metadata?.title;
  if (typeof title === "string" && title.trim()) return title.trim();
  return item.memory.memory_id.split("/").pop() || item.memory.memory_id;
}

/** 统计召回结果中各 Subject 类别的条目数量。 */
function count_subjects(kinds: MemorySubjectKind[]): Record<MemorySubjectKind, number> {
  const counts: Record<MemorySubjectKind, number> = {
    agent: 0,
    user: 0,
    workspace: 0,
    city: 0,
  };
  for (const kind of kinds) counts[kind] += 1;
  return counts;
}

/** 在指定执行范围读取 Provider 状态。 */
async function read_status(
  context: PowerLifecycleContext,
  agent_id: string,
  workspace_id: string,
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
 * 领域 action 已经声明 `access` 与输入 schema；这里只负责把执行范围交给 City，
 * 并把稳定失败结果还原为异常，避免界面把失败当成空数据。
 */
async function invoke_domain_action<TResult>(
  context: PowerLifecycleContext,
  scope: MemoryMainviewScopeInput,
  action_id: string,
  input: PowerJsonObject,
): Promise<TResult> {
  const agents = await context.system.list_agents();
  const agent = agents.find((item) => item.agent_id === scope.agent_id);
  if (!agent) throw new Error(`Agent not found: ${scope.agent_id}`);
  const workspaces = await context.system.list_workspaces();
  const workspace = workspaces.find((item) => item.workspace_id === scope.workspace_id);
  if (!workspace) throw new Error(`Workspace not found: ${scope.workspace_id}`);
  const result = await context.system.invoke_agent_power({
    agent_id: agent.agent_id,
    workspace_id: workspace.workspace_id,
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
    agent_id: scope.agent_id,
    workspace_id: scope.workspace_id,
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
    subject_counts: result.subject_counts,
  };
}

/** 界面 action 输入中的执行范围。 */
interface MemoryMainviewScopeInput {
  /** 目标 Agent 执行范围。 */
  readonly agent_id: string;
  /** 提供 Workspace 作用域的 Workspace ID。 */
  readonly workspace_id: string;
}

/** 读取必填执行范围。 */
function read_scope(input: PowerJsonValue | undefined): MemoryMainviewScopeInput {
  const source = read_record(input);
  return {
    agent_id: read_optional_string(source, "agent_id"),
    workspace_id: read_optional_string(source, "workspace_id"),
  };
}

/** 解析枚举输入。 */
function read_list_input(input: PowerJsonValue | undefined): MemoryMainviewListInput {
  const source = read_record(input);
  const memory_types = Array.isArray(source.memory_types)
    ? source.memory_types.filter((value): value is string => typeof value === "string")
    : undefined;
  return {
    ...read_scope(input),
    ...(read_subject_kinds(source) ? { subject_kinds: read_subject_kinds(source) } : {}),
    ...(memory_types ? { memory_types } : {}),
    ...(typeof source.include_evidence === "boolean"
      ? { include_evidence: source.include_evidence }
      : {}),
    ...(typeof source.limit === "number" ? { limit: source.limit } : {}),
    ...(typeof source.offset === "number" ? { offset: source.offset } : {}),
  };
}

/** 解析召回输入。 */
function read_recall_input(input: PowerJsonValue | undefined): MemoryMainviewRecallInput {
  const source = read_record(input);
  return {
    ...read_scope(input),
    query: read_required_string(source, "query"),
    ...(typeof source.max_results === "number" ? { max_results: source.max_results } : {}),
    ...(typeof source.include_evidence === "boolean"
      ? { include_evidence: source.include_evidence }
      : {}),
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
  const origin = read_optional_string(source, "source");
  return {
    ...read_scope(input),
    content: read_required_string(source, "content"),
    target: read_required_string(source, "target"),
    ...(topic ? { topic } : {}),
    ...(memory_type ? { memory_type } : {}),
    ...(origin ? { source: origin } : {}),
  };
}

/** 解析修订输入。 */
function read_revise_input(input: PowerJsonValue | undefined): MemoryMainviewReviseInput {
  const source = read_record(input);
  const evidence = read_optional_string(source, "evidence");
  return {
    ...read_scope(input),
    memory_id: read_required_string(source, "memory_id"),
    instruction: read_required_string(source, "instruction"),
    ...(evidence ? { evidence } : {}),
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
): MemorySubjectKind[] | undefined {
  if (!Array.isArray(source.subject_kinds)) return undefined;
  const allowed: MemorySubjectKind[] = ["agent", "user", "workspace", "city"];
  const kinds = source.subject_kinds
    .filter((value): value is string => typeof value === "string")
    .filter((value): value is MemorySubjectKind => allowed.includes(value as MemorySubjectKind));
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
