/**
 * Agent 存储写调度的预算、生命周期和观测协议。
 * 请求正文只以已序列化字符串进入队列，字节计费与真正发送到 Worker 的内容一致。
 */

/** 有界调度预算，所有上限均同时包含等待项与运行项。 */
export interface AgentStorageBudgets {
  /** 全部 Agent 可同时持有的写请求数。 */
  global_requests: number;
  /** 全部 Agent 已接受请求的 UTF-8 总字节上限。 */
  global_bytes: number;
  /** 单 Agent 可同时持有的写请求数。 */
  agent_requests: number;
  /** 单 Agent 已接受请求的 UTF-8 总字节上限。 */
  agent_bytes: number;
  /** 单 Session 可同时持有的写请求数。 */
  session_requests: number;
  /** 单 Session 已接受请求的 UTF-8 总字节上限。 */
  session_bytes: number;
  /** 单个序列化请求的最大 UTF-8 字节数。 */
  request_bytes: number;
  /** 不同 Agent 可同时派发的事务数，同 Agent 始终至多一个。 */
  concurrency: number;
  /** 请求尚未派发时的最大等待毫秒数。 */
  queue_timeout_ms: number;
  /** flush/dispose 的最大等待毫秒数；超时不把运行事务视为回滚。 */
  drain_timeout_ms: number;
}

/** 一次待提交的可序列化存储事务。 */
export interface AgentStorageRequest {
  /** 稳定 Agent 存储拥有者标识，不允许以 Workspace 为隔离键。 */
  agent_id: string;
  /** Session session_id；集合操作使用固定的 collection 键。 */
  session_id: string;
  /** 已验证为 JSON 的完整 Worker 请求正文，调度器不记录正文。 */
  payload: string;
  /** 只取消尚未派发的请求，派发后继续等待真实提交结算。 */
  signal?: AbortSignal;
  /** 派发检查点的同步接收校验，抛错表示尚未发送到 Worker。 */
  assert_dispatchable?: () => void;
}

/** 单个请求的分阶段观测，不包含正文或可识别的 Session 地址。 */
export interface AgentStorageTiming {
  /** 真实排队等待毫秒数。 */
  queue_duration_ms: number;
  /** 派发至 Worker 响应的毫秒数，包含 IPC 与事务执行。 */
  execution_duration_ms: number;
  /** 从接受到结算的总毫秒数，供标准 duration 聚合。 */
  duration_ms: number;
  /** 计费的请求 UTF-8 字节数。 */
  request_bytes: number;
  /** 响应是提交成功、失败还是未派发取消。 */
  outcome: "completed" | "failed" | "cancelled";
}

/** 不包含正文的调度器当前状态与水位。 */
export interface AgentStorageQueueStats {
  /** 已接受且尚未结算的请求总数，包含运行项。 */
  requests: number;
  /** 当前已计费的 UTF-8 字节数。 */
  bytes: number;
  /** 当前派发中的 Agent 数量。 */
  running: number;
  /** 从实例创建以来的请求数峰值。 */
  peak_requests: number;
  /** 从实例创建以来的已计费字节数峰值。 */
  peak_bytes: number;
  /** 最早未结算请求的年龄毫秒数，空队列为零。 */
  oldest_age_ms: number;
}

/** 调度器拥有者注入的执行能力与受控观测。 */
export interface AgentStorageSchedulerOptions {
  /** 每次执行一个 Agent 的短事务；拒绝表示真实失败或显式 outcome_unknown。 */
  execute: (agent_id: string, payload: string) => Promise<string>;
  /** 可选覆盖的有限正整数预算，主要用于受限宿主与隔离验收。 */
  budgets?: Partial<AgentStorageBudgets>;
  /** 请求结算后投影观测，观察器异常不能改变已提交业务结果。 */
  observe?: (timing: AgentStorageTiming) => void;
}

/** 同 Agent/Session 的预算计费与排队状态。 */
export interface AgentStorageQueueScope {
  /** 已接受未结算的请求数。 */
  requests: number;
  /** 已接受未结算的序列化字节数。 */
  bytes: number;
}

/** 调度器内部排队项，不越过 Worker 边界。 */
export interface AgentStorageQueueEntry {
  /** 调用方提交的稳定地址、正文和派发检查点。 */
  request: AgentStorageRequest;
  /** 全请求正文的 UTF-8 字节数。 */
  bytes: number;
  /** performance.now 的接受时刻，用于单调计时。 */
  accepted_at: number;
  /** 已派发后不再接受取消。 */
  dispatched: boolean;
  /** 只能结算一次的幂等标志。 */
  settled: boolean;
  /** 清理超时 Timer 和 AbortSignal listener。 */
  cleanup: () => void;
  /** Worker 返回真实响应后完成业务 Promise。 */
  resolve: (response: string) => void;
  /** 真实失败或未接受时拒绝业务 Promise。 */
  reject: (error: unknown) => void;
}

/** Agent 内部的 Session 轮转队列及共享计费。 */
export interface AgentStorageAgentQueue extends AgentStorageQueueScope {
  /** 以稳定 Session 身份划分的 FIFO 等待队列。 */
  sessions: Map<string, AgentStorageQueueEntry[]>;
  /** 正在执行事务时禁止再次派发该 Agent。 */
  running: boolean;
  /** 同 Session 的等待和运行项共享预算。 */
  scopes: Map<string, AgentStorageQueueScope>;
}
