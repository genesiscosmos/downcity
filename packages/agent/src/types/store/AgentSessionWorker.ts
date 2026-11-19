/**
 * Agent 存储 Worker 的固定命令协议。
 * 不发送函数、任意 SQL 或文件系统句柄，Writer 与独立 Reader 使用相同目标身份。
 */
import type { AgentSessionConfigurationUpdate, AgentSessionCheckpointInsert } from "./AgentSessionConfiguration.js";
import type { Worker } from "node:worker_threads";
import type { AgentSessionAddress, AgentSessionCreateRecord, AgentSessionListQuery } from "./AgentSessionDatabase.js";
import type { AgentSessionAppendMessage, AgentSessionMessagePageInput, AgentSessionTruncateMessages, AgentSessionUpdateMessage } from "./AgentSessionMessages.js";

/** 仅读取 canonical 事实的命令。 */
export type AgentSessionReadCommand = {
  /** 只读当前主会话指针；为空返回 null，绝不创建。 */
  command: "main";
} | {
  /** 批量精确查询小字段，不加载正文、配置或全量目录。 */
  command: "metadata";
  /** 最多 100 个明确引用，结果与输入同序。 */
  addresses: readonly import("../agent/SessionMetadata.js").SessionMetadataAddress[];
} | {
  /** 读取持久化归档计划，不扫描当前活动目录。 */
  command: "archive_plan";
  /** 原归档操作UUID。 */
  operation_id: string;
} | {
  /** 只读查询已有分类，不扫描目录。 */
  command: "categories";
  /** 只查询活动或归档范围。 */
  archived: boolean;
} | {
  /** 不加载完整历史的定向消息/统计查询。 */
  command: "first_user" | "latest_agent" | "message_stats";
  /** 目标会话永久 UUID。 */
  session_id: string;
  /** 仅 latest_agent 使用的可选 Turn 过滤。 */
  turn_id?: string;
} | {
  /** 返回跨分类的非终态活动记录，或全部归档记录用于维护；不加载正文。 */
  command: "pending_records" | "archived_records";
} | {
  /** 读取单个 Composer 命名空间的最近累计摘要。 */
  command: "checkpoint";
  /** 会话永久 UUID，不随归档变化。 */
  session_id: string;
  /** Composer 命名空间。 */
  namespace: string;
  /** 目标 checkpoint 自身的结构版本。 */
  schema_version: number;
} | {
  /** 列表只读取 sessions 小字段。 */
  command: "list";
  /** 完整过滤条件和实时游标。 */
  input: AgentSessionListQuery;
} | {
  /** 活动/归档精确地址读取。 */
  command: "find";
  /** 永久身份及可选分类和状态校验。 */
  address: AgentSessionAddress;
} | {
  /** 按稳定记录读取 metadata、配置、非终态消息或轻量输入版本。 */
  command: "record" | "configuration" | "recoverable" | "input_versions";
  /** 已确认的永久会话 UUID。 */
  session_id: string;
} | {
  /** 消息页及同事务 total。 */
  command: "messages";
  /** 目标永久会话 UUID。 */
  session_id: string;
  /** 页大小及 sequence 边界。 */
  input: AgentSessionMessagePageInput;
} | {
  /** 指定消息或 Part 对应消息或 Input 对应消息。 */
  command: "message" | "part_message" | "input_message";
  /** 目标永久会话 UUID。 */
  session_id: string;
  /** 当前 Session 范围中的 message_id / part_id / input_id。 */
  id: string;
} | {
  /** 检查 canonical User/Input 附件授权。 */
  command: "has_attachment";
  /** 目标永久会话 UUID。 */
  session_id: string;
  /** 精确 canonical 文件 URL。 */
  file_path: string;
} | {
  /** 查询已经提交的操作事实，不把缺失当作回滚证明。 */
  command: "receipt";
  /** 原事务幂等 UUID。 */
  operation_id: string;
};

/** 在单写连接中执行的短事务命令。 */
export type AgentSessionWriteCommand = {
  /** 原子选择业务创建键所关联的永久 UUID。 */
  command: "ensure_creation";
  /** 重入和未知确认都使用原操作 UUID。 */
  operation_id: string;
  /** 完整来源、候选 UUID 与独立业务键。 */
  input: import("./AgentSessionDatabase.js").AgentSessionEnsureCreationInput;
} | {
  /** 显式单事务确保主会话；不同并发候选收敛为同一指针。 */
  command: "ensure_main";
  /** 本次确认身份；重入保留原 UUID。 */
  operation_id: string;
  /** 新会话候选及首次创建信息；已有主会话不被重绑。 */
  input: import("./AgentSessionDatabase.js").AgentSessionEnsureMainInput;
} | {
  /** 创建或取得原持久化计划，返回小型确认。 */
  command: "archive_prepare";
  /** 原UUID与根逻辑地址。 */
  input: import("./AgentArchivePlan.js").AgentArchivePlanInput;
} | {
  /** 在同事务推进一个后序节点及归档事实。 */
  command: "archive_node";
  /** 不可变计划身份和节点位置。 */
  input: import("./AgentArchivePlan.js").AgentArchiveNodeCommit;
} | {
  /** 原子更新拆分配置和目录投影。 */
  command: "configure";
  /** 明确省略/null 语义的部分更新。 */
  input: AgentSessionConfigurationUpdate;
} | {
  /** 在 Session/Composer 范围插入累计摘要。 */
  command: "checkpoint_insert";
  /** 必须指向完整稳定单元终点。 */
  input: AgentSessionCheckpointInsert;
} | {
  /** 显式创建记录。 */
  command: "create";
  /** 幂等 UUID。 */
  operation_id: string;
  /** 完整不可变身份及创建时绑定。 */
  input: AgentSessionCreateRecord;
} | {
  /** 活动归档。 */
  command: "archive";
  /** 幂等 UUID。 */
  operation_id: string;
  /** 活动逻辑地址。 */
  address: AgentSessionAddress;
  /** 归档时刻毫秒。 */
  archived_at: number;
} | {
  /** 永久删除并登记附件清理。 */
  command: "remove";
  /** 幂等 UUID。 */
  operation_id: string;
  /** 活动或精确归档地址。 */
  address: AgentSessionAddress;
} | {
  /** 创建消息并由 Worker 分配 sequence。 */
  command: "append";
  /** 序列化领域候选。 */
  input: AgentSessionAppendMessage;
} | {
  /** 增量更新消息。 */
  command: "update";
  /** revision、稳定前缀和变化 Parts。 */
  input: AgentSessionUpdateMessage;
} | {
  /** 截断或清空历史。 */
  command: "truncate";
  /** 保留的 sequence 边界。 */
  input: AgentSessionTruncateMessages;
};

/** Worker 请求包装；目标连接参数由存储拥有者构造，不能来自模型工具直接输入。 */
export interface AgentSessionWorkerRequest {
  /** 与响应对应的进程内递增标识。 */
  request_id: number;
  /** 稳定 Agent 身份。 */
  agent_id: string;
  /** 同一 Agent 不得在同一池内改变目标路径。 */
  database_path: string;
  /** Writer 不接受只读命令之外的动态函数。 */
  readonly: boolean;
  /** 只允许全新离线暂存/新根显式初始化，不由读取隐式创建。 */
  allow_create?: boolean;
  /** 最后一个存储租约释放后关闭此目标连接，不修改业务数据。 */
  release_owner?: boolean;
  /** 语义明确的固定命令。 */
  operation: AgentSessionReadCommand | AgentSessionWriteCommand;
}

/** 可以跨存储边界的安全错误信息；不包含原始 message、stack、SQL 或参数。 */
export interface AgentSessionStorageFailure {
  /** 领域短码或按 SQLite 主类别确定的固定错误码。 */
  code: string;
  /** SQLite 原始数字错误码；非 SQLite 失败时省略。 */
  sqlite_code?: number;
}

/** Worker 响应仅含结果或安全错误信息。 */
export interface AgentSessionWorkerResponse {
  /** 关联原始请求。 */
  request_id: number;
  /** 成功时 JSON 字符串，避免 Worker 错误对象带入正文。 */
  result?: string;
  /** 失败时稳定错误代码，不含 canonical 内容或 SQLite 参数。 */
  error_code?: string;
  /** SQLite 的数字错误码，不包含原始错误消息。 */
  sqlite_code?: number;
}

/** 池内单个按需创建的线程及其有界在途请求。 */
export interface AgentSessionWorkerSlot {
  /** 本槽持有的 SQLite Worker。 */
  worker: Worker;
  /** 创建时的线程编号，退出后仍可关联同一代生命周期。 */
  worker_id: number;
  /** 使用过此线程的内部目标键，仅用于路由诊断，不写入日志。 */
  diagnostic_targets: Set<string>;
  /** 已派发、尚未响应的请求集合。 */
  pending: Map<number, AgentSessionWorkerPending>;
  /** ready 才可派发；terminating 隔离旧线程；terminated 表示已确认退出。 */
  state: "ready" | "terminating" | "terminated";
  /** 本代线程唯一终止信号；拒绝时保留隔离槽，不能创建并行写者。 */
  termination?: Promise<void>;
  /** 终止失败的安全错误；后续等待立即拒绝，保持旧槽隔离。 */
  termination_error?: Error;
  /** 未派发请求的有界等待集合；超时和关闭立即移除，避免在未完成 Promise 上积累回调。 */
  termination_waiters: Set<(error?: Error) => void>;
  /** 无在途请求后回收空闲线程的 Timer。 */
  idle_timer?: ReturnType<typeof setTimeout>;
}

/** Worker 池内部等待项。 */
export interface AgentSessionWorkerPending {
  /** 已派发请求的语义命令名，用于主线程重建安全异常。 */
  command: AgentSessionReadCommand["command"] | AgentSessionWriteCommand["command"];
  /** 内部诊断路由目标，不允许进入日志。 */
  diagnostic_target: string;
  /** 请求实际派发的单调时钟时间，包含 IPC 与执行耗时。 */
  started_at: number;
  /** 响应后完成序列化业务结果。 */
  resolve: (value: string) => void;
  /** IPC 故障以 outcome_unknown 结算在途写操作。 */
  reject: (error: unknown) => void;
  /** 清理有界 IPC 超时。 */
  timer: ReturnType<typeof setTimeout>;
}
