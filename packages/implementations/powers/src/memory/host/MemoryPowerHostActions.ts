/**
 * Memory Power 的宿主管理 actions。
 *
 * 关键点（中文）
 * - Provider 快照直接检查当前实例；范围目录只读宿主资源，不执行领域 action。
 * - Job 管理要求显式选定 Agent；所有内容与 Job 操作都将空 Workspace 视为无项目。
 * - 记忆内容读写通过本 Power 的领域 action，权限判断与 Agent 调用完全一致。
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
  MemoryProvider,
} from "@/memory/types/Memory.js";
import type { MemorySubject } from "@/memory/types/MemoryAccess.js";
import type { MemoryJobView } from "@/memory/types/MemoryJob.js";
import type {
  MemoryManagementScopes,
  MemoryConfigSnapshot,
} from "@/memory/types/MemoryManagement.js";
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
} from "@/memory/types/MemoryMainview.js";

/** 界面默认枚举的条目数量。 */
const DEFAULT_LIST_LIMIT = 50;

/** 注册 Memory Power 的宿主管理 actions。 */
export function register_memory_power_host_actions(
  context: PowerLifecycleContext,
  provider: MemoryProvider,
  model_id?: string,
): void {
  context.power.action({
    id: "memory.config.snapshot",
    run: async () => {
      const snapshot: MemoryConfigSnapshot = {
        knowledge: { status: await provider.inspect() },
        processing: { ...(model_id === undefined ? {} : { model_id }) },
      };
      return as_json(snapshot);
    },
  });
  context.power.action({
    id: "memory.scopes",
    run: async () => as_json(await read_management_scopes(context)),
  });
  context.power.action({
    id: "memory.jobs",
    run: async (input) => {
      const source = read_record(input ?? {});
      return as_json(await invoke_domain_action<{ items: MemoryJobView[]; total: number }>(context, read_scope(source), "jobs", {
        ...(source.limit === undefined ? {} : { limit: source.limit }),
        ...(source.offset === undefined ? {} : { offset: source.offset }),
      }, true));
    },
  });
  for (const action_id of ["job_status", "job_detail", "retry"] as const) {
    context.power.action({
      id: `memory.${action_id}`,
      run: async (input) => {
        const source = read_record(input);
        return as_json(await invoke_domain_action<unknown>(context, read_scope(source), action_id, {
          job_id: read_required_string(source, "job_id"),
        }, true));
      },
    });
  }
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

/** 读取宿主范围目录，只投影名称与标识，不查询领域状态或知识数量。 */
async function read_management_scopes(context: PowerLifecycleContext): Promise<MemoryManagementScopes> {
  const [agents, workspaces] = await Promise.all([
    context.system.list_agents(),
    context.system.list_workspaces(),
  ]);
  return {
    agents: agents.map((agent) => ({ agent_id: agent.agent_id, name: agent.name })),
    workspaces: workspaces.map((workspace) => ({ workspace_id: workspace.workspace_id, name: workspace.name })),
  };
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
  // 详情页的 scope 是读取边界；逻辑 ID 不授予跨 Agent 或项目的读取能力。
  const subject = memory.subject;
  const in_scope = input.scope === "agent"
    ? subject.kind === "user" || subject.kind === "agent" && (!input.agent_id || subject.agent_id === input.agent_id)
    : subject.kind === "city" || subject.kind === "workspace" && subject.workspace_id === input.workspace_id;
  if (memory.memory_id !== input.memory_id || !in_scope) throw new Error("Memory is outside the selected detail scope");
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
  const result = await invoke_domain_action<MemoryJobView>(context, input, "revise", {
    memory_id: input.memory_id,
    instruction: input.instruction,
  });
  const committed = result.status === "succeeded";
  return await mutation_result(context, input, input.memory_id, committed
    ? "记忆已修订。"
    : `修订请求状态：${result.status}。请在处理记录中查看结果。Job ID：${result.job_id}`);
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

/**
 * 在界面选定的执行范围里调用本 Power 的领域 action。
 *
 * 关键点（中文）：领域 action 必须绑定一个真实 Agent，即使要读的是 City 共享记忆；
 * 因此内容入口的 `agent_id` 缺失时回退到第一个可用 Agent；非空无效 ID 必须报错。
 * Job 管理传入 require_selected_scope，要求显式选定 Agent。所有调用中的空 Workspace
 * 都表示无项目。领域 action 已声明 `access` 与输入 schema；这里负责传递范围，
 * 并把稳定失败结果还原为异常，避免界面把失败当成空数据。
 */
async function invoke_domain_action<TResult>(
  context: PowerLifecycleContext,
  scope: MemoryMainviewScopeInput,
  action_id: string,
  input: PowerJsonObject,
  require_selected_scope = false,
): Promise<TResult> {
  if (require_selected_scope && !scope.agent_id) throw new Error("Memory Job management requires a selected Agent");
  const agents = await context.system.list_agents();
  const agent = scope.agent_id
    ? agents.find((item) => item.agent_id === scope.agent_id)
    : agents[0];
  if (!agent) throw new Error(scope.agent_id
    ? "Selected Memory Agent was not found"
    : "Memory requires at least one Agent as execution context");
  const workspaces = await context.system.list_workspaces();
  const workspace = scope.workspace_id
    ? workspaces.find((item) => item.workspace_id === scope.workspace_id)
    : undefined;
  if (scope.workspace_id && !workspace) {
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
