/** Agent DB 的单 Session 存储视图参数；连接和 Worker 始终由集合拥有者持有。 */
import type { FileSystem, SessionOrigin } from "@downcity/type";
import type { AgentSessionRuntimeLease } from "./AgentSessionRuntime.js";
import type { AgentSessionRecord } from "./AgentSessionDatabase.js";

/** 单 Session facade 所需的最小资源。 */
export interface AgentSessionStorageOptions {
  /** 当前 Agent 唯一身份。 */
  agent_id: string;
  /** 逻辑 Session ID；同分类活动记录唯一。 */
  session_id: string;
  /** 完整不可变创建来源。 */
  origin: SessionOrigin;
  /** 创建时可选 Workspace 绑定。 */
  workspace_id?: string;
  /** Agent 私有文件能力，不使用 Workspace 文件能力。 */
  files: FileSystem;
  /** Agent 私有根目录，用于稳定 storage_id 附件目录。 */
  storage_root_path: string;
  /** 集合共享租约；视图 dispose 不关闭该租约。 */
  lease: AgentSessionRuntimeLease;
  /** 已读取的精确记录；打开已有会话时避免隐式创建。 */
  record?: AgentSessionRecord;
}
