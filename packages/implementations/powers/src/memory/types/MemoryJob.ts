/** Memory 内部处理请求、来源边界与暂存结果；Job 不属于用户 Task。 */
import type { MemoryAccessContext, MemoryWriteTarget } from "./MemoryAccess.js";
import type { MemoryType } from "./Memory.js";

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
  role: "user" | "agent" | "request";
  /** 保存于请求中的有界原文，不作为系统指令。 */
  text: string;
}

/** 模型提出的一条变更，实际范围由 Job 绑定。 */
export interface MemoryPlannedChange {
  /** 新增、改写或使既有记录失效。 */
  operation: "create" | "update" | "invalidate";
  /** 更新目标 ID；新增时由宿主分配。 */
  memory_id?: string;
  /** 更新基于的内容版本；新增不提供。 */
  expected_version?: string;
  /** 记忆类型，默认 fact。 */
  memory_type?: MemoryType;
  /** 可读主题。 */
  topic: string;
  /** 新增或改写的完整内容。 */
  content: string;
  /** 支持此变更的输入包来源 ID。 */
  source_ids: string[];
}

/** 一次有界的记忆处理请求。 */
export interface MemoryJob {
  /** Job 稳定标识。 */
  job_id: string;
  /** 上层请求去重键，不包含未授权的自由范围。 */
  request_key: string;
  /** 处理类型。 */
  kind: "digest" | "revise" | "profile_optimize";
  /** 用户指定的处理目标，作为数据传给专用 Session。 */
  instruction: string;
  /** 创建时绑定的可信访问上下文。 */
  access: MemoryAccessContext;
  /** 本 Job 唯一允许写入的目标范围。 */
  target: MemoryWriteTarget;
  /** 需要修订的既有记忆 ID。 */
  memory_id?: string;
  /** 是否操作核心记忆。 */
  mode: "knowledge" | "profile";
  /** 本次允许的有界原始来源。 */
  sources: MemoryJobSource[];
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
  /** Profile 精确编辑基于的完整原始正文版本；提交前必须再次校验。 */
  profile_version?: string;
  /** Profile 暂存结果及输入包来源，只供 Coordinator 校验后提交。 */
  profile_edits?: {
    /** 基于同一原始正文计算的精确编辑，不允许重叠或重复匹配。 */
    edits: {
      /** 必须在原始正文中恰好出现一次的文字。 */
      old_text: string;
      /** 用于替换匹配区域的新文字，可以为空。 */
      new_text: string;
    }[];
    /** 支持整批编辑的已授权输入包来源编号。 */
    source_ids: string[];
  };
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
export type MemoryJobInput = Pick<MemoryJob, "request_key" | "kind" | "instruction" | "access" | "target" | "mode" | "sources" | "memory_id">;

/** 对调用方公开的最小处理状态，不泄露来源正文。 */
export interface MemoryJobView {
  /** 稳定处理 ID。 */
  job_id: string;
  /** 处理种类。 */
  kind: MemoryJob["kind"];
  /** 当前处理状态。 */
  status: MemoryJob["status"];
  /** 本次处理的目标范围。 */
  target: MemoryWriteTarget;
  /** 记忆使用方式。 */
  mode: MemoryJob["mode"];
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

/** 从内部 Job 导出不含证据内容的展示对象。 */
export function memory_job_view(job: MemoryJob): MemoryJobView {
  return {
    job_id: job.job_id, kind: job.kind, status: job.status, target: job.target, mode: job.mode,
    agent_id: job.access.agent_id, workspace_id: job.access.workspace_id,
    session_id: job.session_id, memory_ids: job.memory_ids,
    detail: job.error ?? job.skip_reason, created_at: job.created_at, updated_at: job.updated_at,
  };
}
