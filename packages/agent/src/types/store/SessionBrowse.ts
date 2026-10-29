/** Session 列表投影、快照及 Worker 消息协议；不传递 FileSystem 或 SQLite 实例。 */
import type { AgentSessionSummary, AgentSessionSummaryPage } from "../agent/SessionTypes.js";
import type { SessionHistoryMeta } from "./SessionHistoryMeta.js";
import type { FileSystem, SessionMessage } from "@downcity/type";

/** SQLite 列表状态行。 */
export interface SessionBrowseStateRow {
  /** 会话标识。 */
  session_id: string;
  /** 所属 Agent。 */
  agent_id: string;
  /** 所属 Workspace，空值表示未绑定。 */
  workspace_id: string | null;
  /** 来源 JSON。 */
  origin: string;
  /** 会话时区。 */
  timezone: string;
  /** 会话标题。 */
  title: string | null;
  /** 模型标签。 */
  model_label: string | null;
  /** 审批模式。 */
  approval_mode: "ask" | "always-allow" | null;
  /** 消息总数。 */
  message_count: number;
  /** 最新消息预览。 */
  preview_text: string | null;
  /** 创建时间戳。 */
  created_at: number;
  /** 更新时间戳。 */
  updated_at: number;
}

/** 单条会话详情投影参数。 */
export interface SessionBrowseBaseInput {
  /** 私有存储根目录。 */
  project_root: string;
  /** 所属 Agent。 */
  agent_id: string;
  /** 目录中的会话标识。 */
  session_id: string;
  /** 已读取的元数据。 */
  metadata: SessionHistoryMeta;
  /** 可选完整消息。 */
  messages?: SessionMessage[];
  /** 当前是否执行中。 */
  executing?: boolean;
}

/** 规范化后的查询，同时作为快照绑定内容。 */
export interface SessionBrowseQuery {
  /** Store 实例随机身份，不能跨 Store 使用游标。 */
  store_id: string;
  /** 删除、归档或清空推进的失效世代。 */
  generation: number;
  /** 所属 Agent。 */
  agent_id: string;
  /** 来源分区。 */
  category: string;
  /** 是否归档。 */
  archived: boolean;
  /** Workspace 过滤，空串表示全部。 */
  workspace_id: string;
  /** 来源类型过滤，空串表示全部。 */
  origin_type: string;
  /** 已去空白并转小写的搜索词。 */
  query: string;
}

/** 主线程验证过的数据库候选。 */
export interface SessionBrowseCandidate {
  /** 数据库绝对路径。 */
  database_path: string;
  /** 目录中的会话标识。 */
  session_id: string;
}

/** 不可变摘要快照，构建中也纳入预算。 */
export interface SessionBrowseSnapshot {
  /** 随机快照身份。 */
  snapshot_id: string;
  /** 所属 Store 身份。 */
  store_id: string;
  /** 查询绑定。 */
  query_key: string;
  /** 摘要集合，完成后确定排序。 */
  items: AgentSessionSummary[];
  /** 摘要估算字节数。 */
  bytes: number;
  /** 绝对过期时间戳。 */
  expires_at: number;
}

/** 游标的内部签名负载，不属于公开协议。 */
export interface SessionBrowseCursor {
  /** 快照身份。 */
  snapshot_id: string;
  /** 下一页偏移。 */
  offset: number;
}

/** Worker 单步请求；客户端每次只允许一条挂起消息。 */
export interface SessionBrowseRequest {
  /** 请求序号。 */
  request_id: number;
  /** 开始构建、批量读取、完成构建或读取已有页。 */
  action: "begin" | "batch" | "finish" | "page";
  /** 绑定查询。 */
  query: SessionBrowseQuery;
  /** 当前页上限。 */
  limit: number;
  /** 原样回传的游标。 */
  cursor?: string;
  /** 有背压的候选批次。 */
  candidates?: SessionBrowseCandidate[];
}

/** 立即发送的清理控制消息，与普通 RPC 共用 FIFO，在途最多 128 条。 */
export interface SessionBrowseClearRequest {
  /** 控制消息固定使用零。 */
  request_id: 0;
  /** 清理控制标识。 */
  action: "clear";
  /** 当前调用清理的单个 Store 身份，不延迟合并。 */
  store_ids: string[];
}

/** Worker 结果，错误只跨线程传递消息文本。 */
export interface SessionBrowseResponse {
  /** 对应请求序号。 */
  request_id: number;
  /** 分页结果；构建步骤没有结果。 */
  page?: AgentSessionSummaryPage;
  /** 明确错误消息。 */
  error?: string;
}

/** 主线程浏览客户端所需能力。 */
export interface SessionBrowseOptions {
  /** 私有文件能力，仅主线程使用。 */
  files: FileSystem;
  /** 私有存储根目录。 */
  project_root: string;
  /** 所属 Agent。 */
  agent_id: string;
  /** Store 固定的 Workspace 过滤。 */
  workspace_id?: string;
  /** 是否使用内存数据库。 */
  memory: boolean;
}

/** 单条挂起 RPC，退出与 dispose 必须结算。 */
export interface SessionBrowsePending {
  /** 对应消息序号。 */
  request_id: number;
  /** 成功回调。 */
  resolve: (response: SessionBrowseResponse) => void;
  /** 失败回调。 */
  reject: (error: Error) => void;
  /** RPC 超时定时器。 */
  timer: ReturnType<typeof setTimeout>;
}

/** 单个列表操作的终态取消入口。 */
export interface SessionBrowseOperation {
  /** dispose、失效或超时立即拒绝调用方。 */
  reject: (error: Error) => void;
}

/** 共享 Worker 挂起请求的路由信息。 */
export interface SessionBrowseWorkerPending extends SessionBrowsePending {
  /** 请求所属 Store，用于局部取消。 */
  store_id: string;
}

/** 进程级列表操作占位，包含目录枚举阶段。 */
export interface SessionBrowseAdmission {
  /** Worker 失败时立即结算所属操作。 */
  fail: (error: Error) => void;
  /** 是否需要共享文件 Worker。 */
  file: boolean;
}

/** Store 内有界串行队列项，准入时即计入进程 64 上限。 */
export interface SessionBrowseQueueEntry {
  /** 在轮到本项时开始执行。 */
  run: () => Promise<AgentSessionSummaryPage>;
  /** 成功结算并释放准入。 */
  resolve: (page: AgentSessionSummaryPage) => void;
  /** 取消、超时或失败结算并释放准入。 */
  cancel: (error: Error) => void;
  /** 是否已被取消。 */
  cancelled: boolean;
}

/** 内存数据库逐条投影的加载器，避免先建立无界摘要数组。 */
export type SessionBrowseMemorySource = () => AsyncIterable<SessionBrowseBaseInput>;
