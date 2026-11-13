/**
 * Agent DB 内部关系记录、地址和查询类型。
 * session_key 只用于存储实现；归档和导出使用稳定 storage_id。
 */
import type { SessionOrigin } from "@downcity/type";

/** 不暴露内部整数主键的精确记录地址。 */
export type AgentSessionAddress = {
  /** 活动地址模式，只查询活动记录，绝不回落归档。 */
  archived: false;
  /** 规范化来源分类。 */
  category: string;
  /** 分类内的逻辑 Session ID。 */
  session_id: string;
} | {
  /** 归档地址模式，必须持有条目给出的稳定身份。 */
  archived: true;
  /** 不因归档或主会话重新创建而改变的记录 ID。 */
  storage_id: string;
};

/** sessions 的小字段投影，不包含配置和 canonical 正文。 */
export interface AgentSessionRecord {
  /** 仅限数据库内部 JOIN 和 keyset 使用的整数键。 */
  session_key: number;
  /** 稳定且可导出的随机记录 ID。 */
  storage_id: string;
  /** 分类内逻辑 Session ID，归档后允许重建。 */
  session_id: string;
  /** 与 origin.category 受 CHECK 约束保持一致的分类。 */
  category: string;
  /** 完整不可变来源的 JSON 字符串，由唯一归一化入口创建。 */
  origin: string;
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
  /** 模型绑定 JSON 或 unknown；缺失时不猜测历史 ID。 */
  model_binding: string | null;
  /** configured 审批模式。 */
  approval_mode: "ask" | "always-allow" | null;
  /** 不可变执行配置引用 JSON。 */
  execution_profile: string | null;
  /** 显式 system snapshot，未设置为 null。 */
  system_snapshot: string | null;
}

/** 创建新记录的完整领域身份，不使用文件路径推导。 */
export interface AgentSessionCreateRecord {
  /** 调用方已分配并可在失败重入时复用的 UUID。 */
  storage_id: string;
  /** 非空逻辑 Session ID。 */
  session_id: string;
  /** 不可变完整来源，数据库再验证 category/type。 */
  origin: SessionOrigin;
  /** 创建时可选 Workspace 绑定。 */
  workspace_id?: string;
  /** 创建时区。 */
  timezone: string;
  /** 创建时间戳毫秒。 */
  created_at: number;
}

/** 列表过滤输入，必须经过归一化后绑定游标。 */
export interface AgentSessionListQuery {
  /** 唯一来源分类。 */
  category: string;
  /** 是否仅查询归档。 */
  archived: boolean;
  /** 可选来源角色。 */
  origin_type?: string;
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
