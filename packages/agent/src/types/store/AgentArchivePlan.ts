/** Agent子树归档的持久化操作计划；身份和后序节点在首次prepare后不可变。 */

/** 新建或恢复原归档计划的请求。 */
export interface AgentArchivePlanInput {
  /** 原操作UUID，重入必须复用，不能换ID自动重放。 */
  operation_id: string;
  /** 根的永久 UUID，重入不得指向重建后的主会话。 */
  session_id: string;
  /** 根所属分类，规范化后与原计划相等。 */
  type: string;
}

/** 不可变后序节点与同事务推进的提交事实。 */
export interface AgentArchivePlanNode {
  /** 子节点先于父节点的连续位置，从1开始。 */
  position: number;
  /** 节点永久 UUID，归档和重入始终定位同一会话。 */
  session_id: string;
  /** 计划创建时的分类。 */
  type: string;
  /** 移除通知所需来源角色，不从新记录读取。 */
  kind: string;
  /** 计划创建时的可选Workspace绑定，用于通知事实。 */
  workspace_id: string | null;
  /** 与归档事务同提交的时刻，null表示尚未归档。 */
  committed_at: number | null;
}

/** 归档计划的持久化只读快照。 */
export interface AgentArchivePlan {
  /** 原操作UUID，不与单节点事务receipt混用。 */
  operation_id: string;
  /** 原根永久 UUID，主会话重建不改变已冻结的目标。 */
  root_session_id: string;
  /** 原根分类。 */
  type: string;
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
  /** 原根永久 UUID，防止调用者把另一个计划当作本次重试。 */
  root_session_id: string;
  /** 原计划SHA-256，必须与数据库一致。 */
  fingerprint: string;
  /** 当前后序位置，必须是第一个尚未提交的节点。 */
  position: number;
}
