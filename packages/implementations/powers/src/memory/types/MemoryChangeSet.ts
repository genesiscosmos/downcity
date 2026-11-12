/** 确定性知识变更协议；一个提交只作用于一个可信 target，Provider 不调用模型。 */
import type { MemoryKnowledgeAccess, MemoryWriteTarget } from "./MemoryAccess.js";
import type { MemoryRecord, MemorySourceReference, MemoryType } from "./Memory.js";

/** 知识记录当前的有效状态；删除仅表示逻辑退出，不承诺清除历史副本。 */
export type MemoryValidity = "active" | "invalidated" | "deleted";

/** 一条确定性的完整替换或有效状态变更。 */
export interface MemoryChange {
  /** 操作类型；update 使用完整新内容，不能传自然语言编辑指令。 */
  operation: "create" | "update" | "delete" | "invalidate";
  /** 完整逻辑记录 ID；create 可省略，由 commit_id 和序号确定性分配。 */
  memory_id?: string;
  /** update/delete/invalidate 必须与当前记录版本完全相同。 */
  expected_version?: string;
  /** create/update 的完整正文。 */
  content?: string;
  /** 可读标题，与 Job 的 topic 对应。 */
  topic?: string;
  /** 领域分类；省略时沿用既有分类或使用 fact。 */
  memory_type?: MemoryType;
  /** 可检查的原始依据；create/update 必须至少提供一条。 */
  source_refs: MemorySourceReference[];
  /** 可选事实有效期起点，使用 ISO 8601 时间。 */
  valid_from?: string;
  /** 可选事实有效期终点，使用 ISO 8601 时间。 */
  valid_to?: string;
  /** 由可信服务显式授权重新记住；模型暂存变更不能自行授权。 */
  allow_recreation?: boolean;
}

/** 同一 target 的原子变更集；权限来自 access，不来自模型内容。 */
export interface MemoryChangeSet {
  /** 当前可信访问上下文。 */
  access: MemoryKnowledgeAccess;
  /** 唯一写入目标范围。 */
  target: MemoryWriteTarget;
  /** 稳定提交幂等键；相同键不同请求必须失败。 */
  commit_id: string;
  /** 可选业务请求幂等键；省略时使用 commit_id，同范围相同请求只发布一次。 */
  request_id?: string;
  /** 可选范围版本前置条件；Job 可在计算开始时固定。 */
  expected_scope_version?: string;
  /** 有序变更，每个 memory_id 在同次提交内只能出现一次。 */
  changes: MemoryChange[];
}

/** 一条已经发布的变更摘要。 */
export interface MemoryCommittedChange {
  /** 实际操作类型。 */
  operation: MemoryChange["operation"];
  /** 实际稳定记录 ID。 */
  memory_id: string;
  /** 提交后版本；失效及删除也会产生版本。 */
  version: string;
  /** 提交后有效状态。 */
  validity: MemoryValidity;
}

/** 与数据同次发布的持久化提交回执；重试返回完全相同的回执。 */
export interface MemoryCommitReceipt {
  /** 实际绑定的业务请求幂等键。 */
  request_id: string;
  /** 从可信访问上下文解析的持久化范围标识。 */
  scope_prefix: string;
  /** 稳定提交幂等键。 */
  commit_id: string;
  /** 规范请求的 SHA-256，用于检测幂等键复用。 */
  request_hash: string;
  /** 提交前的范围版本。 */
  previous_scope_version: string;
  /** 提交后的范围版本。 */
  scope_version: string;
  /** 实际变更集合。 */
  changes: MemoryCommittedChange[];
  /** 提交完成的 ISO 8601 时间。 */
  committed_at: string;
}

/** 删除、失效或更正产生的精确内容抑制；不能以此封禁整个会话。 */
export interface MemorySuppression {
  /** 被替代或退出有效集合的记录 ID。 */
  memory_id: string;
  /** 被抑制旧版本。 */
  version: string;
  /** 规范正文的 SHA-256；只能阻止相同正文，不能识别语义改写。 */
  content_hash: string;
  /** 旧内容的具体来源，供 Coordinator 校验重新摄取。 */
  source_refs: MemorySourceReference[];
  /** 抑制原因。 */
  reason: "update" | "delete" | "invalidate";
}

/** 查询一个可写 target 当前版本与抑制信息。 */
export interface MemoryVersionInput {
  /** 当前可信访问上下文。 */
  access: MemoryKnowledgeAccess;
  /** 唯一目标范围。 */
  target: MemoryWriteTarget;
}

/** 一次固定快照上的版本与有效性结果。 */
export interface MemoryVersionResult {
  /** 当前范围版本；尚未提交时为 0。 */
  scope_version: string;
  /** 当前范围内的精确内容抑制信息。 */
  suppressions: MemorySuppression[];
}

/** 按范围查找已经发布的幂等回执。 */
export interface MemoryCommitReceiptInput extends MemoryVersionInput {
  /** 需要查找的提交幂等键。 */
  commit_id: string;
}

/** 权威快照中保存的记录；非 active 状态不进入普通读取和召回。 */
export interface MemoryVersionedRecord {
  /** 完整领域记录。 */
  memory: MemoryRecord;
  /** 当前记录版本。 */
  version: string;
  /** 当前有效状态。 */
  validity: MemoryValidity;
}

/** 可由应用服务检测并重算的版本冲突。 */
export class MemoryVersionConflictError extends Error {
  /** 稳定错误码，避免依赖错误文本。 */
  readonly code = "MEMORY_VERSION_CONFLICT";
  constructor(message: string) { super(message); this.name = "MemoryVersionConflictError"; }
}

/** 确定性提交能力；不提供该能力的 Provider 必须由上层明确拒绝写入。 */
export interface MemoryCommitProvider {
  /** 读取 target 固定快照的范围版本与抑制。 */
  read_version(input: MemoryVersionInput): Promise<MemoryVersionResult>;
  /** 校验并原子发布同一 target 的完整变更。 */
  commit(input: MemoryChangeSet): Promise<MemoryCommitReceipt>;
  /** 查询已发布回执，提交后 Job 恢复使用。 */
  read_commit_receipt(input: MemoryCommitReceiptInput): Promise<MemoryCommitReceipt | null>;
}

/** 规范正文指纹，供 Provider 和重新摄取校验共用。 */
export function normalize_memory_content(content: string): string {
  return content.replace(/\r\n/g, "\n").trim();
}
