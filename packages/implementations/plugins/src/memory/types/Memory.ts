/**
 * Memory Plugin 的公开领域协议。
 *
 * 关键点（中文）
 * - MemoryPlugin 只依赖 MemoryProvider，不感知文件、数据库或远程服务。
 * - 所有公开结果使用稳定 memory_id 与 citation，不暴露物理存储路径。
 * - Provider 负责记忆形成、存储、召回、修订与删除的完整语义。
 */

import type { PluginJsonObject, PluginJsonValue } from "@downcity/city/plugin";
import type {
  MemoryAccessContext,
  MemoryOwner,
  MemorySubject,
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
}

/** Provider 返回的完整记忆记录。 */
export interface MemoryRecord {
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
  metadata?: PluginJsonObject;
}

/** Memory Provider 能力声明。 */
export interface MemoryProviderCapabilities {
  /** Provider 是否支持显式记忆写入。 */
  remember: boolean;

  /** Provider 是否支持查询召回。 */
  recall: boolean;

  /** Provider 是否支持按 memory_id 精确读取。 */
  read: boolean;

  /** Provider 是否支持修订既有记忆。 */
  revise: boolean;

  /** Provider 是否支持删除或失效记忆。 */
  forget: boolean;

  /** Provider 是否支持 Session 摘要提炼。 */
  digest: boolean;

  /** Provider 是否支持生成受预算约束的稳定上下文。 */
  system_context: boolean;

  /** Provider 是否支持持久化等待 Formation 的 canonical Turn Capture Job。 */
  capture_turn: boolean;
}

/** Capture Job 中保存的一条最小 canonical 文本证据。 */
export interface MemoryCaptureMessage {
  /** canonical Session Message 的稳定标识。 */
  message_id: string;

  /** 当前证据的消息角色。 */
  role: "user" | "agent";

  /** 从允许捕获的 canonical text parts 提取的原始文本。 */
  text: string;
}

/** 持久化一个待 Formation Turn 的输入。 */
export interface MemoryCaptureTurnInput {
  /** 当前 Capture 使用的可信 Memory 访问上下文。 */
  access: MemoryAccessContext;

  /** 当前 Turn 所属 Session 的稳定标识。 */
  session_id: string;

  /** 当前 Turn 的稳定标识。 */
  turn_id: string;

  /** 通过本地预检的最小 canonical 文本证据。 */
  messages: MemoryCaptureMessage[];
}

/** Capture Job 持久化结果。 */
export interface MemoryCaptureTurnResult {
  /** Provider 内稳定且可幂等重试的 Job 标识。 */
  job_id: string;

  /** 本次调用新建了 Job，或命中了已存在的相同 Turn Job。 */
  mode: "created" | "existing";

  /** Job 当前等待后续 Formation 的状态。 */
  status: "pending";
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
  details?: PluginJsonObject;

  /** Provider 当前需要提示给调用方的非致命警告。 */
  warnings?: string[];
}

/** 召回长期记忆的输入。 */
export interface MemoryRecallInput {
  /** 需要检索的自然语言查询。 */
  query: string;

  /** 当前召回请求使用的可信访问上下文。 */
  access: MemoryAccessContext;

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
  access: MemoryAccessContext;

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

/** 显式形成长期记忆的输入。 */
export interface MemoryRememberInput {
  /** 需要长期保留的原始内容。 */
  content: string;

  /** 当前写入请求使用的可信访问上下文。 */
  access: MemoryAccessContext;

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

/** 把 Session 内容提炼为长期记忆的输入。 */
export interface MemoryDigestInput {
  /** 需要提炼的 Session 标识。 */
  session_id: string;

  /** 当前提炼请求使用的可信访问上下文。 */
  access: MemoryAccessContext;

  /** 由 MemoryPlugin 从 canonical Session 提取的文本。 */
  transcript: string;

  /** 实际参与提炼的消息条数。 */
  message_count: number;
}

/** 把 Session 内容提炼为长期记忆的结果。 */
export interface MemoryDigestResult {
  /** 本次形成或更新的稳定记忆标识集合。 */
  memory_ids: string[];

  /** Provider 可选生成的 Session 证据标识。 */
  evidence_id?: string;

  /** 实际参与提炼的消息条数。 */
  message_count: number;

  /** 本次提炼是仅归档还是生成了长期投影。 */
  mode: "archived" | "projected";

  /** Provider 可选返回的简短结果摘要。 */
  summary?: string;
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

/** 修订既有记忆的结果。 */
export interface MemoryReviseResult {
  /** 实际被修订的稳定记忆标识。 */
  memory_id: string;

  /** Provider 可选生成的修订证据标识。 */
  evidence_id?: string;

  /** Provider 是否完成内容替换或采用追加式降级。 */
  mode: "revised" | "appended";

  /** Provider 可选返回的简短结果摘要。 */
  summary?: string;
}

/** 删除或失效一条记忆的输入。 */
export interface MemoryForgetInput {
  /** 需要删除或失效的稳定记忆标识。 */
  memory_id: string;

  /** 当前删除请求使用的可信访问上下文。 */
  access: MemoryAccessContext;
}

/** 删除或失效一条记忆的结果。 */
export interface MemoryForgetResult {
  /** 目标稳定记忆标识。 */
  memory_id: string;

  /** Provider 是否删除或失效了对应记忆。 */
  forgotten: boolean;
}

/** Provider 生成稳定上下文时的预算输入。 */
export interface MemorySystemContextInput {
  /** 当前上下文请求使用的可信访问上下文。 */
  access: MemoryAccessContext;

  /** 允许返回的最大记忆条数。 */
  max_items: number;

  /** 允许返回的最大总字符数。 */
  max_chars: number;
}

/** 一条可进入 system context 的稳定记忆。 */
export interface MemorySystemContextItem {
  /** 当前稳定记忆标识。 */
  memory_id: string;

  /** 当前 Core 内容描述的 Subject，用于生成独立命名 block。 */
  subject: MemorySubject;

  /** 当前记忆的有界文本内容。 */
  content: string;

  /** 当前内容的可选逻辑引用。 */
  citation?: string;
}

/** Provider 生成的稳定上下文结果。 */
export interface MemorySystemContextResult {
  /** 按注入优先级排列的稳定记忆。 */
  items: MemorySystemContextItem[];
}

/** MemoryPlugin 依赖的最小 Provider 协议。 */
export interface MemoryProvider {
  /** Provider 的稳定名称。 */
  readonly name: string;

  /** Provider 支持的领域能力声明。 */
  readonly capabilities: MemoryProviderCapabilities;

  /** 初始化当前 City Plugin 实例持有的 Provider 生命周期。 */
  initialize(): Promise<void>;

  /** 读取 Provider 当前状态与统计。 */
  status(access: MemoryAccessContext): Promise<MemoryStatusResult>;

  /** 按查询与作用域召回长期记忆。 */
  recall(input: MemoryRecallInput): Promise<MemoryRecallResult>;

  /** 按稳定标识精确读取一条记忆。 */
  read(input: MemoryReadInput): Promise<MemoryReadResult>;

  /** 显式形成或更新一条长期记忆。 */
  remember(input: MemoryRememberInput): Promise<MemoryRememberResult>;

  /** 把 Session 文本提炼为长期记忆。 */
  digest(input: MemoryDigestInput): Promise<MemoryDigestResult>;

  /** 基于新证据修订既有记忆。 */
  revise(input: MemoryReviseInput): Promise<MemoryReviseResult>;

  /** 删除或失效一条记忆。 */
  forget(input: MemoryForgetInput): Promise<MemoryForgetResult>;

  /** 生成受预算约束的稳定 system context。 */
  system_context(
    input: MemorySystemContextInput,
  ): Promise<MemorySystemContextResult>;

  /** 幂等持久化一个通过预检、等待 Formation 的 canonical Turn。 */
  capture_turn(input: MemoryCaptureTurnInput): Promise<MemoryCaptureTurnResult>;

  /** 释放 Provider 持有的存储、索引和后台任务。 */
  dispose(): Promise<void>;
}

/** MemoryPlugin 的显式构造参数。 */
export interface MemoryPluginOptions {
  /** 当前启用的 Memory Provider。 */
  provider?: "builtin";
  /** 当前启用的 Memory Storage。 */
  storage?: "file";
  /** City 为当前 MemoryPlugin 唯一实例分配的私有绝对数据目录。 */
  storage_root_path?: string;
}

/** Memory action 可以接受的公开 JSON payload 联合。 */
export type MemoryActionPayload =
  | Omit<MemoryRecallInput, "access">
  | Omit<MemoryReadInput, "access">
  | Omit<MemoryRememberInput, "access">
  | Omit<MemoryDigestInput, "access" | "transcript" | "message_count">
  | Omit<MemoryReviseInput, "access">
  | Omit<MemoryForgetInput, "access">
  | Record<string, PluginJsonValue>;
