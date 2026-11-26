/**
 * Agent DB 内部关系记录、地址和查询类型。
 * session_key 只用于存储实现；所有活动、归档和转移引用均使用永久 session_id。
 */
import type { SessionDescriptor } from "@downcity/type";

/** 不暴露内部整数主键的精确记录地址。 */
export interface AgentSessionAddress {
  /** 期望的归档状态；不匹配返回不存在，不解析另一条记录。 */
  archived: boolean;
  /** 可选来源分类校验，不参与身份命名空间。 */
  type?: string;
  /** 不因归档、Workspace 变化或同记录转移而改变的 UUIDv4。 */
  session_id: string;
}

/** sessions 的小字段投影，不包含配置和 canonical 正文。 */
export interface AgentSessionRecord {
  /** 仅限数据库内部 JOIN 和 keyset 使用的整数键。 */
  session_key: number;
  /** 全分类及活动/归档范围内永久唯一的 UUIDv4。 */
  session_id: string;
  /** 与 descriptor.type 受 CHECK 约束保持一致的分类。 */
  type: string;
  /** 完整不可变来源的 JSON 字符串，由唯一归一化入口创建。 */
  kind: string;
  /** 不包含 type/kind 的不可变派生与群组创建事实 JSON。 */
  relations: string;
  /** 可变 Workspace 绑定；脱离项目时为 null。 */
  workspace_id: string | null;
  /** 当前 Session 的时区标识。 */
  timezone: string;
  /** 可选用户标题。 */
  title: string | null;
  /** 列表模型标签，不用于推测实际模型 ID。 */
  model_label: string | null;
  /** 0 为活动、1 为归档。 */
  archived: number;
  /** 归档时间戳毫秒，活动为 null。 */
  archived_at: number | null;
  /** 与 canonical 写入同事务维护的真实消息数。 */
  message_count: number;
  /** 最多 180 字符的列表预览。 */
  preview_text: string | null;
  /** 每次持久化变更推进的目录 revision。 */
  revision: number;
  /** 记录创建时间戳毫秒。 */
  created_at: number;
  /** 最近持久化变化时间戳毫秒。 */
  updated_at: number;
}

/** 拆表后独立读取的配置；列表禁止 JOIN 此表。 */
export interface AgentSessionConfigurationRow {
  /** 配置所属内部 Session 主键。 */
  session_key: number;
  /** configured 审批模式。 */
  approval_mode: "ask" | "always-allow" | null;
  /** 不可变执行配置引用 JSON。 */
  execution_profile: string | null;
  /** 显式 system snapshot，未设置为 null。 */
  system_snapshot: string | null;
}

/** 创建新记录的完整领域身份，不使用文件路径推导。 */
export interface AgentSessionCreateRecord extends SessionDescriptor {
  /** 可选的初始标题，与目录身份在同一事务落盘。 */
  title?: string;
  /** 调用方已分配的永久 UUIDv4；同 operation_id 重入必须使用相同候选。 */
  session_id: string;

  /** 创建时可选 Workspace 绑定。 */
  workspace_id?: string;
  /** 创建时区。 */
  timezone: string;
  /** 创建时间戳毫秒。 */
  created_at: number;
}

/** 专用执行的幂等业务键；键映射与会话创建同事务提交。 */
export interface AgentSessionEnsureCreationInput extends AgentSessionCreateRecord {
  /** 当前 Agent/分类内的持久业务键，不用于计算永久身份。 */
  creation_key: string;
}

/** 显式确保主会话的事务输入；来源由存储固定为 chat/agent。 */
export interface AgentSessionEnsureMainInput {
  /** 事务尚未选中主会话时使用的新 UUIDv4，不从 Agent ID 派生。 */
  session_id: string;
  /** 首次创建时的时区；已有主会话不更改配置。 */
  timezone: string;
  /** 首次创建时间戳毫秒，重入保持原值。 */
  created_at: number;
  /** 首次创建的可选 Workspace；已有指针不重新绑定。 */
  workspace_id?: string;
}

/** 列表过滤输入，必须经过归一化后绑定游标。 */
export interface AgentSessionListQuery {
  /** 唯一来源分类。 */
  type: string;
  /** 是否仅查询归档。 */
  archived: boolean;
  /** 可选来源角色。 */
  kind?: string;
  /** 可选 Workspace ID，不参与不可变身份。 */
  workspace_id?: string;
  /** ID、标题和预览的字面包含匹配，不是全文检索。 */
  query?: string;
  /** 默认 30，最大 200。 */
  limit?: number;
  /** HMAC 绑定过滤条件和 generation 的不透明 keyset 游标。 */
  cursor?: string;
}

/** 实时 keyset 查询结果；跨页不承诺冻结快照。 */
export interface AgentSessionRecordPage {
  /** 当前短事务读取的小字段条目。 */
  items: AgentSessionRecord[];
  /** 与本页同一短事务计算的精确匹配数量。 */
  total: number;
  /** 是否发现 limit 之外的下一条记录。 */
  has_more: boolean;
  /** 下一页游标，有后续记录时才返回。 */
  next_cursor?: string;
}

/** 存储拥有者的明确初始化参数，仅由 Worker 或隔离工具创建。 */
export interface AgentSessionDatabaseOptions {
  /** Agent 持久化身份。 */
  agent_id: string;
  /** 数据库绝对路径或拥有者唯一的 :memory:；不会创建父目录。 */
  database_path: string;
  /** 只读连接不创建文件、不运行 schema DDL。 */
  readonly?: boolean;
  /** 只有显式新根初始化或离线暂存允许创建全新目标库。 */
  allow_create?: boolean;
}

/** 事务提交的小型幂等确认，不复制 canonical 正文。 */
export interface AgentSessionOperationReceipt {
  /** 请求的确定性 SHA-256，拒绝同 ID 不同请求。 */
  request_hash: string;
  /** 提交后的小型业务结果。 */
  result: unknown;
  /** 数据与 receipt 同事务提交的时间戳毫秒。 */
  committed_at: number;
}

/** 已签名游标的严格内层格式，不记录到日志。 */
export interface AgentSessionCursorPayload {
  /** 游标协议与 schema 的版本。 */
  version: number;
  /** 原始 Agent 数据库拥有者。 */
  agent_id: string;
  /** 整库恢复/替换时推进的存储世代。 */
  generation: string;
  /** 完整归一化过滤条件的摘要。 */
  filter_hash: string;
  /** 上页最后一条的更新时间戳毫秒。 */
  updated_at: number;
  /** 上页最后一条的内部排序键。 */
  session_key: number;
}

/** 所有权校验和签名所需的唯一数据库元数据。 */
export interface AgentSessionDatabaseMetadata {
  /** 数据库实际 Agent 身份。 */
  agent_id: string;
  /** 整库世代，恢复后更换。 */
  generation: string;
  /** HMAC 密钥，不允许导出到日志或用户响应。 */
  cursor_secret: Uint8Array;
  /** 目标业务首次写入时刻；迁移暂存转换保持 null。 */
  first_business_write_at: number | null;
}
