/** 显式附件维护的公开输入/结果；只消费DB已提交日志，不从目录推断垃圾。 */

/** 单次维护固定一个Agent和一个有界日志页。 */
export interface AgentAttachmentCleanupInput {
  /** Agent不可变标识，必须匹配sessions.db元数据。 */
  agent_id: string;
  /** 已存在Agent存储根绝对路径，不接受Workspace或Session逻辑路径。 */
  storage_root_path: string;
  /** 单次日志上限1..100，默认20；不会递归扫描其他UUID。 */
  limit?: number;
  /** 单记录最多检查的文件/目录数1..100000，默认10000；超额保留日志。 */
  max_entries?: number;
  /** 仅初始化缺失的附件协调描述，不删除文件或消费日志；必须离线显式执行。 */
  prepare_only?: boolean;
}

/** 每条失败保留对应日志，错误不包含文件正文或外部路径。 */
export interface AgentAttachmentCleanupFailure {
  /** 原删除记录UUID，不使用同逻辑新会话的身份。 */
  session_id: string;
  /** 固定可识别的失败码，原权限/IO错误仅映射安全类别。 */
  code: string;
}

/** 完成=所有所属文件移除后日志结算；下一次不会重复扫描已结算UUID。 */
export interface AgentAttachmentCleanupResult {
  /** 结果所属Agent。 */
  agent_id: string;
  /** 本次是否仅准备协调描述。 */
  prepared: boolean;
  /** 本次完整删除或已不存在、且日志已结算的原记录UUID。 */
  completed: string[];
  /** 未结算的失败项；可显式重试。 */
  failed: AgentAttachmentCleanupFailure[];
  /** 当前仍待处理的日志数，不是磁盘目录数。 */
  remaining: number;
}
