/** 同一 scope 的确定性原子变更、不可变历史与回执协议。 */
import type { MemoryKnowledgeAccess } from "./MemoryAccess.js";
import type { MemoryContent, MemoryRecord, MemoryScope, MemoryScopeType, MemorySource, MemoryState, MemoryWriteResult } from "./MemoryRecord.js";

/** 所有来源已由宿主固化，模型 stage 不能直接构造此结构。 */
export type MemoryChange =
  | (MemoryContent & {
      /** 创建稳定对象，不由模型指定 ID 或版本。 */
      operation: "create";
      /** 宿主固化的实际证据。 */
      sources: MemorySource[];
    })
  | {
      /** 完整替换既有对象。 */
      operation: "update";
      /** 已授权读取的对象身份。 */
      memory_id: string;
      /** 实际读到的版本。 */
      expected_version: string;
      /** 完整正文。 */
      content: string;
      /** Knowledge 必填，Agreement 禁止。 */
      title?: string;
      /** 宿主固化的本版依据。 */
      sources: MemorySource[];
    }
  | {
      /** 退出有效集合；delete 需显式任务授权。 */
      operation: "delete" | "invalidate";
      /** 已读对象身份。 */
      memory_id: string;
      /** 已读版本。 */
      expected_version: string;
      /** 当前操作的真实来源。 */
      sources: MemorySource[];
    };

/** 唯一提交器输入，所有入口使用同一事务。 */
export interface MemoryChangeSet {
  /** 可信宿主权限。 */
  access: MemoryKnowledgeAccess;
  /** 唯一范围选择。 */
  scope: MemoryScopeType;
  /** 稳定提交键。 */
  commit_id: string;
  /** 可跨调用复用的业务幂等键。 */
  request_id?: string;
  /** 计算开始时绑定的范围版本。 */
  expected_scope_version?: string;
  /** 1 至 500 条同范围操作。 */
  changes: MemoryChange[];
  /** 统一应用服务固定的业务参数指纹，模型不可设置。 */
  business_hash?: string;
  /** 认证管理端明确重新记住所指墓碑；普通模型入口不能构造。 */
  recreation?: { /** 退出对象。 */ memory_id: string; /** 已读取的墓碑版本。 */ expected_version: string };
}
/** 与 manifest 原子发布的提交回执。 */
export interface MemoryCommitReceipt {
  /** 请求稳定身份。 */
  request_id: string;
  /** 真实归属。 */
  scope: MemoryScope;
  /** 稳定提交身份。 */
  commit_id: string;
  /** 不含捕获时钟的规范业务输入指纹。 */
  request_hash: string;
  /** 即时写入的固定业务参数指纹，用于前置重放校验。 */
  business_hash?: string;
  /** 发布前范围版本。 */
  previous_scope_version: string;
  /** 发布后范围版本。 */
  scope_version: string;
  /** 每项固定结果，重放不读取后来版本冒充原结果。 */
  changes: MemoryWriteResult[];
  /** 持久提交时间。 */
  committed_at: string;
}
/** 精确抑制不声称识别语义改写。 */
export interface MemorySuppression {
  /** 原对象身份。 */
  memory_id: string;
  /** 被替代版本。 */
  version: string;
  /** 规范正文指纹。 */
  content_hash: string;
  /** 原始依据沿革。 */
  sources: MemorySource[];
  /** 退出原因。 */
  reason: "update" | "delete" | "invalidate";
}
/** 固定版本查询输入。 */
export interface MemoryVersionInput {
  /** 可信访问权限。 */
  access: MemoryKnowledgeAccess;
  /** 唯一范围。 */
  scope: MemoryScopeType;
}
/** 整理计算的固定前置条件。 */
export interface MemoryVersionResult {
  /** 当前范围版本。 */
  scope_version: string;
  /** 精确内容及原始来源抑制。 */
  suppressions: MemorySuppression[];
}
/** 恢复已提交 Job 的固定回执输入。 */
export interface MemoryCommitReceiptInput extends MemoryVersionInput {
  /** 原始提交身份。 */
  commit_id: string;
}
/** manifest 仅引用已持久化的不可变记录。 */
export interface MemoryRecordPointer {
  /** 不可变版本的内部 key，不暴露给 Agent。 */
  key: string;
  /** 指针绑定的版本。 */
  version: string;
  /** 当前有效性。 */
  state: MemoryState;
  /** 不可变文件的校验指纹。 */
  hash: string;
}
/** 单 scope 唯一权威 manifest，Agreement 和 Knowledge 共存。 */
export interface MemoryScopeManifest {
  /** 新记录协议版本，未知版本拒绝读取。 */
  schema_version: 2;
  /** 已确认迁移完成或明确为空的激活标记。 */
  activation: "migrated" | "confirmed_empty";
  /** 真实归属。 */
  scope: MemoryScope;
  /** 内部隔离前缀。 */
  scope_prefix: string;
  /** 当前范围版本。 */
  scope_version: string;
  /** 所有对象当前版本引用，包含墓碑。 */
  records: Record<string, MemoryRecordPointer>;
  /** 不可变版本沿革。 */
  history: Record<string, MemoryRecordPointer[]>;
  /** 同次发布的稳定回执。 */
  receipts: Record<string, MemoryCommitReceipt>;
  /** 精确内容抑制。 */
  suppressions: MemorySuppression[];
  /** 明确重新记住时保留旧墓碑与新对象的审计关联。 */
  recreations?: { /** 原墓碑。 */ tombstone_id: string; /** 原版本。 */ tombstone_version: string; /** 新对象。 */ memory_id: string; /** 本次提交。 */ commit_id: string }[];
}
/** 后端必须整体实现的强事务端口。 */
export interface MemoryCommitProvider {
  /** 在跨进程锁内校验并一次发布。 */
  /** 单独授权的固定版本历史，普通召回不能访问。 */
  read_history(input: { /** 可信管理权限。 */ access: MemoryKnowledgeAccess; /** 目标对象。 */ memory_id: string }): Promise<MemoryRecord[]>;
  commit(input: MemoryChangeSet): Promise<MemoryCommitReceipt>;
  /** 获取固定范围版本及抑制。 */
  read_version(input: MemoryVersionInput): Promise<MemoryVersionResult>;
  /** 恢复固定回执，不重放未知效果。 */
  read_commit_receipt(input: MemoryCommitReceiptInput): Promise<MemoryCommitReceipt | null>;
}
/** 冲突不会自动替换 expected_version。 */
export class MemoryVersionConflictError extends Error {
  /** 稳定公开错误码。 */
  readonly code = "VERSION_CONFLICT";
  /** 当前版本供界面保留草稿后刷新。 */
  readonly current_version?: string;
  constructor(message: string, current_version?: string) {
    super(`VERSION_CONFLICT: ${message}${current_version ? ` (current_version=${current_version})` : ""}`); this.name = "MemoryVersionConflictError"; this.current_version = current_version;
  }
}
/** 只规范行尾和外侧空白，不丢失正文条件。 */
export function normalize_memory_content(content: string): string {
  return content.replace(/\r\n?/gu, "\n").trim();
}
