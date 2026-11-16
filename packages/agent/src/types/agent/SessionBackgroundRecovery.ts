/** 后台续轮扫描的窄依赖与安全定位信息；不承载消息正文。 */
import type { AgentSession } from "./SessionActor.js";

/** 单次扫描或恢复失败所属的持久化地址与阶段。 */
export interface SessionBackgroundRecoveryContext {
  /** 当前扫描的来源分类。 */
  category: string;
  /** 当前 Session 逻辑 ID；列表查询失败时尚未确定。 */
  session_id?: string;
  /** 最新可信输入所属 Turn；消息读取前可能尚未确定。 */
  turn_id?: string;
  /** 区分目录查询、视图读取、消息读取、完成事实查询、装配和状态收口。 */
  phase: "list_sessions" | "read_session" | "read_messages" | "read_completion" | "read_recoverable_messages" | "restore_session" | "restore_status";
}

/** 恢复器只借用完成事实与装配能力，不拥有模型或完成投递队列。 */
export interface SessionBackgroundRecoveryOptions {
  /** 只为尚需收口的受信后台输入装配原 Session。 */
  restore: (session_id: string, category: string) => Promise<Pick<AgentSession, "status">>;
  /** 读取该 Turn 的权威完成事实；与通知是否投递成功无关。 */
  is_completed: (session_id: string, turn_id: string) => Promise<boolean>;
  /** 完成日志可能先于 canonical 收口写入；仍有 streaming Message 时必须恢复收口。 */
  has_recoverable_messages: (session_id: string, category: string) => Promise<boolean>;
  /** 保留原异常与定位信息，单会话失败后继续扫描。 */
  report_error: (error: unknown, context: SessionBackgroundRecoveryContext) => void;
}
