/**
 * Memory Power 的公开领域协议。
 *
 * 关键点（中文）
 * - MemoryPower 只依赖 MemoryProvider，不感知文件、数据库或远程服务。
 * - 所有公开结果使用稳定 memory_id 与 citation，不暴露物理存储路径。
 * - Provider 提供知识查询与持久化能力；提炼由 Processing 负责，Profile 独立管理。
 */
import type { ModelReference } from "@downcity/type";
import type { PowerJsonObject, PowerJsonValue } from "@downcity/city/power";
import type { MemoryCommitProvider } from "./MemoryChangeSet.js";
import type {
  MemoryAccessContext,
  MemoryKnowledgeAccess,
  MemoryOwner,
  MemorySubject,
  MemorySubjectKind,
  MemoryWriteTarget,
} from "@/memory/types/MemoryAccess.js";

/** 长期记忆的领域分类。 */
export type MemoryType =
  | "fact"
  | "preference"
  | "decision"
  | "episode"
  | "procedure"
  | "document";

/** Memory Provider 当前生命周期状态。 */
export type MemoryProviderState = "ready" | "degraded";

/** 一条记忆引用的原始证据。 */
export interface MemorySourceReference {
  /** Provider 内稳定的证据标识。 */
  source_id: string;

  /** 证据来源类别，例如 manual、session 或 external。 */
  source_type: string;

  /** 可选的人类可读来源说明。 */
  label?: string;
  /** 原始证据所属 Agent，不能替代读取授权。 */
  agent_id?: string;
  /** 原始 Session 分类。 */
  category?: string;
  /** 原始 Session 稳定标识。 */
  session_id?: string;
  /** 原始消息稳定标识，避免只按整个 Session 抑制。 */
  message_id?: string;
  /** 原始证据角色，区分用户表述、Agent 结论与显式请求。 */
  role?: "user" | "agent" | "request" | "tool";
  /** 有界证据摘录；保留及共享权限由应用服务裁决。 */
  excerpt?: string;
  /** 可选原始内容内定位，供同一消息中多个事实分别处理。 */
  locator?: string;
}

/** Provider 返回的完整记忆记录。 */
export interface MemoryRecord {
  /** 记录的乐观并发版本；Builtin Provider 读取始终提供。 */
  version?: string;
  /** 记录当前有效状态；普通读取只返回 active。 */
  validity?: import("./MemoryChangeSet.js").MemoryValidity;
  /** Provider 内稳定且不依赖物理文件名的记忆标识。 */
  memory_id: string;

  /** 当前记忆的领域分类。 */
  memory_type: MemoryType;

  /** 维护当前记录与权限的唯一所有者。 */
  owner: MemoryOwner;

  /** 当前记录实际描述的用户、Workspace、Agent 或 City。 */
  subject: MemorySubject;

  /** 当前记忆的完整可读内容。 */
  content: string;

  /** 当前内容被观察或形成的 ISO 8601 时间。 */
  observed_at: string;

  /** 当前事实开始有效的可选 ISO 8601 时间。 */
  valid_from?: string;

  /** 当前事实结束有效的可选 ISO 8601 时间。 */
  valid_to?: string;

  /** 支撑当前记忆的证据引用集合。 */
  source_refs: MemorySourceReference[];

  /** Provider 对当前记忆的可选置信度，范围为 0 到 1。 */
  confidence?: number;

  /** Provider 生成的可审计逻辑引用，不得是宿主物理文件路径。 */
  citation?: string;

  /** Provider 可选返回的结构化扩展元数据。 */
  metadata?: PowerJsonObject;
}

/** Memory Provider 能力声明。 */
export interface MemoryProviderCapabilities {
  /** Provider 是否支持显式记忆写入。 */
  remember: boolean;

  /** Provider 是否支持查询召回。 */
  recall: boolean;

  /** Provider 是否支持按 memory_id 精确读取。 */
  read: boolean;

  /** Provider 是否支持按作用域枚举记忆。 */
  list: boolean;

  /** Provider 是否支持删除或失效记忆。 */
  forget: boolean;

  /** Provider 是否提供版本检查、原子变更集与持久回执的事务端口。 */
  transactions: boolean;

}

/** Provider 状态查询结果。 */
export interface MemoryStatusResult {
  /** 当前 Provider 的稳定名称。 */
  provider: string;

  /** 当前 Provider 的生命周期状态。 */
  state: MemoryProviderState;

  /** 当前 Provider 的能力声明。 */
  capabilities: MemoryProviderCapabilities;

  /** Provider 可选返回的结构化状态统计。 */
  details?: PowerJsonObject;

  /** Provider 当前需要提示给调用方的非致命警告。 */
  warnings?: string[];
}

/** 召回长期记忆的输入。 */
export interface MemoryRecallInput {
  /** 可选的可信写入目标；指定时在扫描、打分与截断前只查询该范围。 */
  target?: MemoryWriteTarget;

  /** 需要检索的自然语言查询。 */
  query: string;

  /** 当前召回请求使用的可信访问上下文。 */
  access: MemoryKnowledgeAccess;

  /** 可选最大返回条数。 */
  max_results?: number;

  /** 可选最小相关性分数，范围为 0 到 1。 */
  min_score?: number;

  /** 是否允许召回原始证据记录。 */
  include_evidence?: boolean;
}

/** 一条召回结果。 */
export interface MemoryRecallItem {
  /** 当前命中的完整记忆记录。 */
  memory: MemoryRecord;

  /** Provider 归一化后的相关性分数，范围为 0 到 1。 */
  score: number;

  /** 适合注入上下文的有界内容片段。 */
  snippet: string;
}

/** 召回长期记忆的结果。 */
export interface MemoryRecallResult {
  /** 执行本次召回的 Provider 名称。 */
  provider: string;

  /** 按 Provider 排序后的召回项。 */
  items: MemoryRecallItem[];

  /** Provider 当前需要提示给调用方的非致命警告。 */
  warnings?: string[];
}

/** 精确读取一条记忆的输入。 */
export interface MemoryReadInput {
  /** 需要读取的稳定记忆标识。 */
  memory_id: string;

  /** 当前读取请求使用的可信访问上下文。 */
  access: MemoryKnowledgeAccess;

  /** 可选起始行号，使用 1-based 语义。 */
  from_line?: number;

  /** 可选最大读取行数。 */
  line_count?: number;
}

/** 精确读取一条记忆的结果。 */
export interface MemoryReadResult {
  /** 目标稳定记忆标识。 */
  memory_id: string;

  /** 匹配到的记忆记录；不存在时为空。 */
  memory: MemoryRecord | null;
}

/** 枚举长期记忆的输入。 */
export interface MemoryListInput {
  /** 当前枚举请求使用的可信访问上下文。 */
  access: MemoryKnowledgeAccess;

  /** 只返回这些 Subject 类别的记忆；不传时返回全部可读 Subject。 */
  subject_kinds?: MemorySubjectKind[];

  /** 只返回这些领域分类的记忆；不传时返回全部分类。 */
  memory_types?: MemoryType[];

  /** 是否把原始证据记录一并列出。 */
  include_evidence?: boolean;

  /** 最多返回的条目数量。 */
  limit?: number;

  /** 跳过的条目数量，用于分页。 */
  offset?: number;
}

/** 枚举结果中的一条记忆摘要。 */
export interface MemoryListItem {
  /** 稳定且不依赖物理文件名的记忆标识。 */
  memory_id: string;

  /** 当前记忆的领域分类。 */
  memory_type: MemoryType;

  /** 当前记忆实际描述的主体。 */
  subject: MemorySubject;

  /** 由 Provider 标题或记忆标识推导的展示名称。 */
  title: string;

  /** 适合列表展示的有界内容片段。 */
  snippet: string;

  /** 当前内容被观察或形成的 ISO 8601 时间。 */
  observed_at: string;

  /** Provider 生成的可审计逻辑引用。 */
  citation?: string;

  /** 当前条目是原始证据记录，而不是长期记忆投影。 */
  is_evidence: boolean;
}

/** 枚举长期记忆的结果。 */
export interface MemoryListResult {
  /** 执行本次枚举的 Provider 名称。 */
  provider: string;

  /** 应用全部过滤条件后的分页条目。 */
  items: MemoryListItem[];

  /** 应用全部过滤条件后的条目总数。 */
  total: number;

  /** 忽略过滤条件时，各 Subject 类别当前可读的条目数量。 */
  subject_counts: Record<MemorySubjectKind, number>;

  /** Provider 当前需要提示给调用方的非致命警告。 */
  warnings?: string[];
}

/** 显式形成长期记忆的输入。 */
export interface MemoryRememberInput {
  /** 可选的稳定请求幂等键；应用服务重试时必须复用。 */
  request_id?: string;
  /** 可检查的原始依据；省略时生成标记为显式请求的来源，不伪造会话证据。 */
  source_refs?: MemorySourceReference[];

  /** 需要长期保留的原始内容。 */
  content: string;

  /** 当前写入请求使用的可信访问上下文。 */
  access: MemoryKnowledgeAccess;

  /** 有限语义写入目标；Provider 负责解析真实 owner 与 subject。 */
  target: MemoryWriteTarget;

  /** 可选的人类可读主题，用于帮助 Provider 组织内容。 */
  topic?: string;

  /** 可选目标记忆分类。 */
  memory_type?: MemoryType;

  /** 可选的原始来源说明。 */
  source?: string;
}

/** 显式形成长期记忆的结果。 */
export interface MemoryRememberResult {
  /** 最终形成或更新的稳定记忆标识。 */
  memory_id: string;

  /** Provider 可选生成的原始证据标识。 */
  evidence_id?: string;

  /** 本次操作是新建还是更新既有记忆。 */
  mode: "created" | "updated";

  /** Provider 可选返回的简短结果摘要。 */
  summary?: string;
}

/** 请求专用 Session 提炼长期记忆的输入，返回 MemoryJobView。 */
export interface MemoryDigestInput {
  /** 原始会话标识。 */
  session_id: string;
  /** 原始会话类型。 */
  type: "chat" | "work";
  /** 本次明确允许的唯一写入范围。 */
  target: MemoryWriteTarget;
  /** 源消息数量上限，默认 30，最大 100。 */
  max_messages?: number;
}

/** 修订既有记忆的输入。 */
export interface MemoryReviseInput {
  /** 需要修订的稳定记忆标识。 */
  memory_id: string;

  /** 当前修订请求使用的可信访问上下文。 */
  access: MemoryAccessContext;

  /** 描述目标变更的明确修订指令。 */
  instruction: string;

  /** 可选的新证据内容。 */
  evidence?: string;
}

/** 删除或失效一条记忆的输入。 */
export interface MemoryForgetInput {
  /** 需要删除或失效的稳定记忆标识。 */
  memory_id: string;

  /** 当前删除请求使用的可信访问上下文。 */
  access: MemoryKnowledgeAccess;
}

/** 删除或失效一条记忆的结果。 */
export interface MemoryForgetResult {
  /** 目标稳定记忆标识。 */
  memory_id: string;

  /** Provider 是否删除或失效了对应记忆。 */
  forgotten: boolean;
}

/** MemoryPower 依赖的最小 Provider 协议。 */
export interface MemoryProvider {
  /** 可选强事务端口；缺省时仍可提供读取和检索，依赖事务的工作流必须拒绝启动。 */
  readonly transactions?: MemoryCommitProvider;
  /** Provider 的稳定名称。 */
  readonly name: string;

  /** Provider 支持的领域能力声明。 */
  readonly capabilities: MemoryProviderCapabilities;

  /** 初始化当前 City Power 实例持有的 Provider 生命周期。 */
  initialize(): Promise<void>;

  /** 读取全局生命周期、存储 Adapter 与能力；无需访问上下文，不读取记忆或计算范围统计。 */
  inspect(): Promise<MemoryStatusResult>;

  /** 读取当前访问范围内的 Provider 状态与统计。 */
  status(access: MemoryKnowledgeAccess): Promise<MemoryStatusResult>;

  /** 按查询与作用域召回长期记忆。 */
  recall(input: MemoryRecallInput): Promise<MemoryRecallResult>;

  /** 按稳定标识精确读取一条记忆。 */
  read(input: MemoryReadInput): Promise<MemoryReadResult>;

  /** 按当前访问上下文枚举可读记忆，供目录浏览与界面展示。 */
  list(input: MemoryListInput): Promise<MemoryListResult>;

  /** 删除或失效一条记忆。 */
  forget(input: MemoryForgetInput): Promise<MemoryForgetResult>;

  /** 释放 Provider 持有的存储、索引和后台任务。 */
  dispose(): Promise<void>;
}

/** MemoryPower 的显式构造参数。 */
export interface MemoryPowerOptions {
  /** 记忆或 Profile 正文实际提交后的业务回调；不包含 Action 或 UI 概念。 */
  readonly on_changed?: import("./MemoryChange.js").MemoryChangeHandler;
  /** 可信可重放业务事实接线；自动开关单独按 Agent/Workspace/target 持久化，默认关闭。 */
  dreaming?: import("./MemoryDream.js").MemoryDreamOptions;
  /** 专用 Memory 模型；新 Job 在提交时捕获，已有 Job 不跟随配置变化。 */
  model?: ModelReference;
  /** 配置中明确确认的非秘密持久授权来源；与 model 配对，不能在后台补成当前账号。 */
  binding_id?: string;
  /** 提交时从可信宿主读取默认/专用模型基线；不会用于恢复或重试已有 Job。 */
  resolve_model_binding?: import("./MemoryModelBinding.js").MemoryModelResolver;
  /** 宿主注入的知识后端；省略时创建 Builtin。生命周期由 Power 管理，Profile 不经过此后端。 */
  provider?: MemoryProvider;
  /** City 为当前 MemoryPower 唯一实例分配的共享绝对数据目录；通常由 City 生命周期提供。 */
  shared_root_path?: string;
  /** 平台数据根目录；用于定位 `agents/<agent_id>/memory` 下的 Agent 私有记忆。 */
  platform_root_path?: string;
}

/** Memory action 可以接受的公开 JSON payload 联合。 */
export type MemoryActionPayload =
  | Omit<MemoryRecallInput, "access">
  | Omit<MemoryReadInput, "access">
  | Omit<MemoryListInput, "access">
  | Omit<MemoryRememberInput, "access">
  | MemoryDigestInput
  | Omit<MemoryReviseInput, "access">
  | Omit<MemoryForgetInput, "access">
  | Record<string, PowerJsonValue>;
