/** Agent DB 的单 Session 存储视图参数；连接和 Worker 始终由集合拥有者持有。 */
import type { FileSystem, SessionDescriptor } from "@downcity/type";
import type { AgentSessionRuntimeLease } from "./AgentSessionRuntime.js";
import type { AgentSessionRecord } from "./AgentSessionDatabase.js";

/** 单 Session facade 所需的最小资源。 */
export interface AgentSessionStorageOptions extends SessionDescriptor {
  /** 首次创建时保存的可选标题；恢复已有记录时不覆盖。 */
  title?: string;
  /** 当前 Agent 唯一身份。 */
  agent_id: string;
  /** 永久唯一的 Session UUID；归档不改变身份，分类不扩大其作用域。 */
  session_id: string;

  /** 创建时可选 Workspace 绑定。 */
  workspace_id?: string;
  /** Agent 私有文件能力，不使用 Workspace 文件能力。 */
  files: FileSystem;
  /** Agent 私有根目录，用于稳定 session_id 附件目录。 */
  storage_root_path: string;
  /** 集合共享租约；视图 dispose 不关闭该租约。 */
  lease: AgentSessionRuntimeLease;
  /** 已读取的精确记录；打开已有会话时避免隐式创建。 */
  record?: AgentSessionRecord;
}
