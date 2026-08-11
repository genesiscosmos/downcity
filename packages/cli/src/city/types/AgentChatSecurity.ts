/**
 * Agent Chat Session 安全设置控制器类型。
 *
 * 只描述远程安全配置事务与 TUI 状态投影之间的依赖。
 */

import type {
  AgentSessionSecurityStatus,
  RemoteAgentSession,
} from "@downcity/agent";

/** Chat 安全设置控制器的构造依赖。 */
export interface AgentChatSecurityControllerOptions {
  /** 读取当前 TUI 激活的远程 Session。 */
  get_session: () => RemoteAgentSession | null;
  /** 读取当前 TUI 激活的 Session ID。 */
  get_session_id: () => string;
  /** 读取当前 Session 已接受的审批模式。 */
  get_approval_mode: () => AgentSessionSecurityStatus["approval_mode"] | undefined;
  /** Session 状态刷新成功后的投影回调。 */
  on_status: (input: {
    /** 当前 Session 是否正在执行 Turn。 */
    is_executing: boolean;
    /** 当前 Session configured 与 effective 审批状态。 */
    security: AgentSessionSecurityStatus;
  }) => void;
  /** 安全配置更新失败时的用户可见错误回调。 */
  on_error: (message: string) => void;
}
