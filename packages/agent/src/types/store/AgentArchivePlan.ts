/** Agent子树归档的持久化操作计划；身份和后序节点在首次prepare后不可变。 */

/** 新建或恢复原归档计划的请求。 */
export interface AgentArchivePlanInput {
  /** 原操作UUID，重入必须复用，不能换ID自动重放。 */
  operation_id: string;
  /** 根的逻辑Session ID，用于与原计划交叉校验。 */
  session_id: string;
  /** 根所属分类，规范化后与原计划相等。 */
  category: string;
  /** 可选的根不可变记录UUID；提供时拒绝同逻辑新记录替代。 */
  root_storage_id?: string;
}

/** 不可变后序节点与同事务推进的提交事实。 */
export interface AgentArchivePlanNode {
  /** 子节点先于父节点的连续位置，从1开始。 */
  position: number;
  /** 节点不可变UUID，归档按此定位，绝不按逻辑ID选择其他记录。 */
  storage_id: string;
  /** 计划创建时的逻辑Session ID。 */
  session_id: string;
  /** 计划创建时的分类。 */
  category: string;
  /** 移除通知所需来源角色，不从新记录读取。 */
  origin_type: string;
  /** 计划创建时的可选Workspace绑定，用于通知事实。 */
  workspace_id: string | null;
  /** 与归档事务同提交的时刻，null表示尚未归档。 */
  committed_at: number | null;
}

/** 归档计划的持久化只读快照。 */
export interface AgentArchivePlan {
  /** 原操作UUID，不与单节点事务receipt混用。 */
  operation_id: string;
  /** 原根UUID，在同逻辑地址重建后保持不变。 */
  root_storage_id: string;
  /** 原根逻辑ID。 */
  session_id: string;
  /** 原根分类。 */
  category: string;
  /** 根和不可变后序节点的SHA-256，用于检测计划损坏。 */
  fingerprint: string;
  /** 计划创建的时间戳毫秒。 */
  created_at: number;
  /** 全部节点提交后最后一笔事务保存的完成时刻。 */
  completed_at: number | null;
  /** 固定后序节点，重入不加入新后代。 */
  nodes: AgentArchivePlanNode[];
}

/** 节点提交命令，不允许调用者更改原计划目标。 */
export interface AgentArchiveNodeCommit {
  /** 固定计划UUID。 */
  operation_id: string;
  /** 原根UUID，防止调用者把另一个计划当作本次重试。 */
  root_storage_id: string;
  /** 原计划SHA-256，必须与数据库一致。 */
  fingerprint: string;
  /** 当前后序位置，必须是第一个尚未提交的节点。 */
  position: number;
}
