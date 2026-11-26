/** Memory 内部处理请求、来源边界与暂存结果；Job 不属于用户 Task。 */
import type { ModelReference } from "@downcity/type";
import type { MemoryAccessContext, MemoryScopeType } from "./MemoryAccess.js";
import type { MemoryKind, MemorySource } from "./MemoryProtocol.js";

/** 有界、带身份的原始消息证据。 */
export interface MemoryJobSource {
  /** 该输入包内稳定的来源编号。 */
  source_id: string;
  /** 原始 Session 所属 Agent；显式内容使用当前 Agent。 */
  agent_id: string;
  /** 原始 Session 的物理分类。 */
  category: string;
  /** 原始会话 ID；显式提交内容可省略。 */
  session_id?: string;
  /** 原始消息 ID；非消息输入可省略。 */
  message_id?: string;
  /** 证据角色，不能将 Agent 建议升级为用户表述。 */
  role: MemorySource["role"];
  /** 原始事实与固定读取区间的定位说明，自动来源提交后保留以供回查。 */
  label?: string;
  /** 保存于请求中的有界原文，不作为系统指令。 */
  text: string;
  /** 宿主固化的真实来源，缺失历史只允许只读审计。 */
  bound_source?: MemorySource;
}

/** 模型提出的一条变更，实际范围由 Job 绑定。 */
export interface MemoryPlannedChange {
  /** 新增、改写或使既有记录失效。 */
  operation: "create" | "update" | "invalidate" | "delete";
  /** 更新目标 ID；新增时由宿主分配。 */
  memory_id?: string;
  /** 更新基于的内容版本；新增不提供。 */
  expected_version?: string;
  /** 记忆类型，默认 fact。 */
  kind?: MemoryKind;
  /** 可读主题。 */
  title?: string;
  /** 新增或改写的完整内容。 */
  content?: string;
  /** 支持此变更的输入包来源 ID。 */
  source_ids: string[];
}

/** 暂存时固定的正文快照；详情展示不得用当前正文替代。 */
export interface MemoryJobContentSnapshot {
  /** 当时读取或计划写入的原文；Profile 为精确编辑区域。 */
  content: string;
  /** 当时记录的内容种类。 */
  kind?: MemoryKind;
  /** Knowledge 当时的真实标题，Agreement 不提供。 */
  title?: string;
  /** 已读取正文的真实版本；尚未提交的新正文没有版本。 */
  version?: string;
  /** 知识记录当时或计划的有效状态；Profile 不使用此字段。 */
  state?: "active" | "invalidated" | "deleted";
}

/** 从 Job 已授权输入包中截取的原文证据，不重新读取来源。 */
export interface MemoryJobSourceExcerpt {
  /** 输入包内稳定的来源编号。 */
  source_id: string;
  /** 原始来源所属 Agent。 */
  agent_id: string;
  /** 原始 Session 的物理分类。 */
  category: string;
  /** 原始 Session 标识；显式请求可省略。 */
  session_id?: string;
  /** 原始消息标识；非消息输入可省略。 */
  message_id?: string;
  /** 原始证据角色，保留用户、Agent 与显式请求的区别。 */
  role: MemoryJobSource["role"];
  /** 在已授权 source.text 中精确匹配的有界原文摘录。 */
  excerpt: string;
  /** 摘录在 source.text 内的 UTF-16 起始偏移。 */
  excerpt_start: number;
  /** 来源是否还有未展示的原文，避免把摘录误认为完整内容。 */
  truncated: boolean;
}

/** 一条暂存变更的可审计差异；是否生效必须结合所属 Job 状态判断。 */
export interface MemoryJobChangeDetail {
  /** 知识操作或 Profile 的精确区域替换。 */
  operation: MemoryPlannedChange["operation"];
  /** 知识目标标识；新建待宿主提交后补齐，Profile 不提供。 */
  memory_id?: string;
  /** 当前变更的人类可读主题。 */
  label: string;
  /** 此变更基于的真实读取版本；新建不提供。 */
  expected_version?: string;
  /** 暂存前的固定原文；新建使用 null，不从当前版本回填。 */
  before: MemoryJobContentSnapshot | null;
  /** 计划写入的固定原文；失效操作保留正文并标记 invalidated。 */
  after: MemoryJobContentSnapshot;
  /** 宿主读取并固定差异内容的 ISO 8601 时间。 */
  captured_at: string;
  /** 仅来自当前 Job 授权输入包的具体来源摘录。 */
  sources: MemoryJobSourceExcerpt[];
}

/** 一次有界的记忆处理请求。 */
export interface MemoryJob {
  /** Job 稳定标识。 */
  job_id: string;
  /** 上层请求去重键，不包含未授权的自由范围。 */
  request_key: string;
  /** 处理类型。 */
  kind: "digest" | "revise" | "optimize" | "dream";
  /** 用户指定的处理目标，作为数据传给专用 Session。 */
  instruction: string;
  /** 创建时绑定的可信访问上下文。 */
  access: MemoryAccessContext;
  /** 本 Job 唯一允许写入的目标范围。 */
  scope: MemoryScopeType;
  /** 需要修订的既有记忆 ID。 */
  memory_id?: string;
  /** revise 固定已读版本。 */
  expected_version?: string;
  /** optimize 固定范围版本，不能在计算前重新捕获覆盖。 */
  input_scope_version?: string;
  /** optimize 明确目标清单，暂存前逐条读取。 */
  inventory?: { /** 稳定对象身份。 */ memory_id: string; /** 已固定版本。 */ version: string }[];
  /** 是否操作核心记忆。 */
  memory_kind: MemoryKind;
  /** 本次允许的有界原始来源。 */
  sources: MemoryJobSource[];
  /** 提交时固定的精确执行模型；历史缺失时必须先配置，重试不得捕获当前模型。 */
  model?: ModelReference;
  /** 提交时确认的非秘密持久授权来源；与 model 配对并跨 attempt 保留。 */
  binding_id?: string;
  /** 当前处理状态。 */
  status: "queued" | "running" | "committing" | "retry_wait" | "succeeded" | "skipped" | "failed";
  /** 已启动的模型计算次数。 */
  attempt: number;
  /** 当前尝试的 Memory Session ID。 */
  session_id?: string;
  /** 当前尝试的 Turn ID。 */
  turn_id?: string;
  /** 本次计算开始时固定的知识范围版本，提交前必须仍匹配。 */
  scope_version?: string;
  /** 模型通过受限工具暂存的变更。 */
  changes?: MemoryPlannedChange[];
  /** 与 changes 或 Profile edits 同批暂存的固定差异；不表示已提交。 */
  change_details?: MemoryJobChangeDetail[];
  /** 无需变更时的明确原因。 */
  skip_reason?: string;
  /** 成功提交产生的记忆 ID。 */
  memory_ids?: string[];
  /** 最近错误，不能将其包装成成功。 */
  error?: string;
  /** 创建时间。 */
  created_at: string;
  /** 最后持久化时间。 */
  updated_at: string;
}

/** 创建请求时由应用服务提供的不可变输入。 */
export type MemoryJobInput = Pick<MemoryJob, "request_key" | "kind" | "instruction" | "access" | "scope" | "memory_kind" | "sources" | "memory_id" | "expected_version" | "input_scope_version" | "inventory" | "model" | "binding_id">;

/** 对调用方公开的最小处理状态，不泄露来源正文。 */
export interface MemoryJobView {
  /** 稳定处理 ID。 */
  job_id: string;
  /** 处理种类。 */
  kind: MemoryJob["kind"];
  /** 当前处理状态。 */
  status: MemoryJob["status"];
  /** 本次处理的目标范围。 */
  scope: MemoryScopeType;
  /** 记忆使用方式。 */
  memory_kind: MemoryJob["memory_kind"];
  /** 发起处理的 Agent ID。 */
  agent_id: string;
  /** 项目范围，若有。 */
  workspace_id?: string;
  /** 当前尝试关联的工作 Session。 */
  session_id?: string;
  /** 提交产生的记忆 ID。 */
  memory_ids?: string[];
  /** 错误或无需变更说明。 */
  detail?: string;
  /** 记录创建时间。 */
  created_at: string;
  /** 状态最后变化时间。 */
  updated_at: string;
}

/** 经宿主按 Job 访问范围校验后返回的详情；列表接口不包含来源正文。 */
export interface MemoryJobDetail {
  /** 不含来源正文的 Job 状态和范围，用于判断差异是否已提交。 */
  job: MemoryJobView;
  /** 暂存时固定的知识或 Profile 差异；缺失历史快照时返回空数组。 */
  changes: MemoryJobChangeDetail[];
}

/** 从内部 Job 导出不含证据内容的展示对象。 */
export function memory_job_view(job: MemoryJob): MemoryJobView {
  return {
    job_id: job.job_id, kind: job.kind, status: job.status, scope: job.scope, memory_kind: job.memory_kind,
    agent_id: job.access.agent_id, workspace_id: job.access.workspace_id,
    session_id: job.session_id, memory_ids: job.memory_ids,
    detail: job.error ?? job.skip_reason, created_at: job.created_at, updated_at: job.updated_at,
  };
}
