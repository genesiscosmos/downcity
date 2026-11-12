/**
 * 文件交互查询的内部协议与生命周期类型。
 * 只描述一次扫描的候选和临时结果，不构成 pending 事实源，不进入公开导出。
 */
import type { FileSystem } from "@downcity/type";
import type { AgentInteraction } from "../agent/AgentInteractions.js";

/** 由 Store 私有路径能力枚举的单库读取目标。 */
export interface SessionInteractionCandidate {
  /** 已通过存在性检查、由 LocalStorePaths 构造的数据库路径。 */
  database_path: string;
  /** 目录对应的预期 Session 身份，必须与库内一致。 */
  session_id: string;
  /** 解码后的完整来源分类，必须与库内 origin.category 一致。 */
  category: string;
}

/** 每次 RPC 只携带一个有界批次，不在 Worker 留存扫描状态。 */
export interface SessionInteractionRequest {
  /** 进程内单调递增的请求标识，迟到响应不得复用。 */
  request_id: number;
  /** 当前 Store 所属 Agent 身份，逐库严格校验。 */
  agent_id: string;
  /** 保留枚举顺序的候选，最多 32 条且序列化不超过 256 KiB。 */
  candidates: SessionInteractionCandidate[];
}

/** 批次全成功才返回结果，业务读取错误保持原消息。 */
export interface SessionInteractionResponse {
  /** 对应请求的唯一标识。 */
  request_id: number;
  /** 按候选及原 Reader 顺序拼接的完整投影。 */
  items?: AgentInteraction[];
  /** 任一候选失败时的原始错误消息，此时不得携带部分结果。 */
  error?: string;
}

/** 进程持有的物理 RPC，取消调用方不能提前移除此记录。 */
export interface SessionInteractionPending {
  /** 成功响应的接收入口。 */
  resolve: (items: AgentInteraction[]) => void;
  /** 读取、超时或线程退出的失败入口。 */
  reject: (error: Error) => void;
  /** RPC 硬时限，完成或终止线程时清理。 */
  timer: ReturnType<typeof setTimeout>;
}

/** 一个 Store 所拥有的私有读取能力。 */
export interface SessionInteractionOptions {
  /** Agent 私有文件系统，仅在宿主枚举目录，不传入 Worker。 */
  files: FileSystem;
  /** Agent 私有存储根目录，用于现有路径 helper。 */
  storage_root_path: string;
  /** 所有候选预期归属的 Agent 标识。 */
  agent_id: string;
}

/** 已准入的串行扫描项，调用结算和资源结算分别处理。 */
export interface SessionInteractionEntry {
  /** 操作创建时的 Store 世代。 */
  generation: number;
  /** 首次取消原因；后续异步检查点直接抛出。 */
  failure?: Error;
  /** 一次性发布调用结果并清理总时限。 */
  resolve: (items: AgentInteraction[]) => void;
  /** 一次性拒绝调用方；物理执行期间仍保留准入。 */
  cancel: (error: Error) => void;
  /** 幂等归还进程操作容量。 */
  release: () => void;
}
