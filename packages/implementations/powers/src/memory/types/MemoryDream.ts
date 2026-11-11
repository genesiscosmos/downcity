/** Memory 内部做梦契约：可信事实、有界固定批次、预算和水位；不属于业务 Task。 */
import type { MemoryAccessContext } from "./MemoryAccess.js";
import type { MemoryJobInput, MemoryJobSource, MemoryJobView } from "./MemoryJob.js";

export interface MemoryDreamScope {
  /** 固定执行 Agent；不得混合其他 Agent 私有材料。 */
  agent_id: string;
  /** 可选来源项目，不赋予项目共享权限。 */
  workspace_id?: string;
  /** 首期只允许 Agent 私有或有明确共享授权的 Workspace 长期知识。 */
  target: "agent" | "current_workspace";
}

export interface MemorySignalInput extends MemoryDreamScope {
  /** 来源领域的稳定事件身份，相同身份不得复用为不同正文。 */
  event_id: string;
  /** 明确命令事实类别，不依据普通 Turn 或模型猜测产生。 */
  event_type: "user_correction" | "task_accepted";
  /** 可信接线指定的生产模块，模型不得指定此字段。 */
  producer: "task" | "explicit_user";
  /** 事实发生的 ISO 时间，与接收时间独立。 */
  occurred_at: string;
  /** 固定的有界原始证据包，保留 request/user/agent 角色。 */
  sources: MemoryJobSource[];
  /** 来源领域固定的交付物、消息和读取区间定位，不允许处理时扩大。 */
  source_boundary: string;
  /** 只有显式共享输入才为 true；私有材料不能自动提升为 Workspace。 */
  workspace_share_allowed: boolean;
  /** 来源固定失败时的错误，保留积压并禁止调用模型。 */
  source_error?: string;
}

export interface MemorySignal extends MemorySignalInput {
  /** 生产者、事件与目标范围生成的确定性内部身份。 */
  signal_id: string;
  /** 输入内容和边界的固定指纹。 */
  fingerprint: string;
  /** 本范围内可靠接收的连续序号，不代表已经完成。 */
  sequence: number;
  /** 持久化接收的 ISO 时间。 */
  received_at: string;
  /** received/assigned/processed/error 分别表示接收、绑定、已对账与来源错误。 */
  state: "received" | "assigned" | "processed" | "error";
  /** 一旦分批就固定的批次身份。 */
  batch_id?: string;
}

export interface MemoryDreamBatch {
  /** 同一范围、策略版本和固定信号集合的确定性身份。 */
  batch_id: string;
  /** 本批固定输入信号，后来的材料进入其他批次。 */
  signal_ids: string[];
  /** 来源包与边界的指纹，恢复时不得换输入。 */
  source_fingerprint: string;
  /** 独立的选材和处理策略版本。 */
  policy_version: string;
  /** 此 City 的持久处理根身份，其他 City 不接管其私有 Job。 */
  owner_id: string;
  /** 不可变 Job 输入，崩溃后以同一请求键重新发布。 */
  input: MemoryJobInput;
  /** 根据固定 Job 输入预先计算的唯一处理身份。 */
  job_id: string;
  /** 批次状态与 Job 投递状态独立，failed 不消耗输入。 */
  status: "planned" | "queued" | "succeeded" | "skipped" | "failed";
  /** 最近一次执行或对账错误，不能包装为成功。 */
  error?: string;
  /** 形成不可变批次的 ISO 时间。 */
  created_at: string;
}

export interface MemoryDreamLedger {
  /** 明确选定的执行和唯一写入范围。 */
  scope: MemoryDreamScope;
  /** 默认关闭，只有宿主管理入口明确配置才启用。 */
  enabled: boolean;
  /** 已持久接收的最后连续序号。 */
  accepted_cursor: number;
  /** 仅 succeeded/skipped 连续对账后推进，前方错误会阻断。 */
  processed_watermark: number;
  /** 可靠接收的原始事实和处理绑定。 */
  signals: MemorySignal[];
  /** 固定批次、Job 关联和对账状态。 */
  batches: MemoryDreamBatch[];
  /** 当前 UTC 日期，用于每日计算批次上限。 */
  budget_day: string;
  /** 今日已预留的自动计算批次数，重启不重置。 */
  budget_used: number;
  /** 冷却或预算延期后的最早可运行 ISO 时间。 */
  next_run_at?: string;
  /** 当前停用、等待显式请求、冷却或预算延期原因。 */
  defer_reason?: string;
  /** 来源读取、摄取或执行的最近错误。 */
  last_error?: string;
}

/** Builtin 管理页的已启用整理摘要；不返回来源正文、批次或其他 City 的 Job。 */
export interface MemoryDreamSummary {
  /** 已登记、启用且宿主当前仍可管理的准确执行与写入范围。 */
  scope: MemoryDreamScope;
  /** 尚未对账成功的信号数，包含已分配、失败和来源错误信号。 */
  backlog: number;
  /** 最近来源读取、摄取或执行错误；不存在错误时省略。 */
  last_error?: string;
}

export interface MemoryDreamView {
  /** 当前明确范围的持久调度状态。 */
  ledger: MemoryDreamLedger;
  /** 尚未对账成功的信号数，包含错误和失败。 */
  backlog: number;
  /** 本 City 可读取的对应 Job 状态，不等于聊天投递结果。 */
  jobs: MemoryJobView[];
  /** 当前查看者 City 的持久处理根身份。 */
  owner_id: string;
}

export interface MemoryDreamOptions {
  /** 由宿主组合根注入的可信、可重放业务事实源；没有端口时不扫描历史。 */
  read_signals?: () => Promise<MemorySignalInput[]>;
}

/** 从已验证的宿主范围解析真正的访问身份，不接受来源正文指定权限。 */
export type MemoryDreamAccessResolver = (scope: MemoryDreamScope) => Promise<MemoryAccessContext>;
