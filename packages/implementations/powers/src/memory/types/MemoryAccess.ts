/** Memory 宿主授权上下文；模型不能传入身份来取得权限。 */
export type { MemoryScope, MemoryScopeType } from "./MemoryRecord.js";

/** MemoryPower 根据可信运行时状态生成的访问上下文。 */
export interface MemoryAccessContext {
  /** 当前 MemoryPower 实例所属 Agent。 */
  agent_id: string;

  /** 当前调用绑定的 Workspace，也是 Workspace 范围的唯一授权标识。 */
  workspace_id?: string;

  /** 当前调用所属 Session；非 Session 调用时省略。 */
  session_id?: string;

  /** 宿主是否提供承载 Workspace 范围的共享 Store。 */
  city_memory_available: boolean;
}

/** Trusted host access is bound to the one local User, never an execution Agent. */
export interface MemoryUserAccessContext {
  /** Distinguishes host ownership from ordinary Agent execution access. */
  authority: "local_user";
  /** 认证路由核对目录后绑定的管理对象范围，模型无法填写。 */
  managed_scope?: import("./MemoryRecord.js").MemoryScope;
  /** The local User identity verified by the host. */
  user_id: string;
  /** User management has no execution Agent. */
  agent_id?: never;
  /** User management cannot select a Workspace. */
  workspace_id?: never;
  /** 管理权限通过 managed_scope 绑定对象，不借用执行期共享存储能力。 */
  city_memory_available: false;
  /** Host operations are not conversation requests. */
  session_id?: never;
}

/** Knowledge backends accept execution access or explicitly bound local User access. */
export type MemoryKnowledgeAccess = MemoryAccessContext | MemoryUserAccessContext;
