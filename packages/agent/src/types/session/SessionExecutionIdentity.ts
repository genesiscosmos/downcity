/**
 * Session 执行代次协议。
 * 逻辑 Turn 可以重试；每次重试使用新的执行身份，恢复未结束执行时保留已保存身份。
 * 该检查点只用于身份和取消边界，不保存模型输入、输出或第二份运行状态。
 */

/** 一次具体执行的持久化身份。 */
export interface SessionExecutionIdentity {
  /** 执行所属的逻辑 Turn；同 Turn 重试时保持不变。 */
  turn_id: string;
  /** 本次执行唯一标识；同 Turn 的不同重试不得复用。 */
  execution_id: string;
}

/** Agent 提供给 SessionLoop 的执行身份检查点。 */
export interface SessionExecutionIdentityStore {
  /** 读取该会话最近一次执行身份；不存在时返回空。 */
  read(session_id: string, type: string): Promise<SessionExecutionIdentity | undefined>;
  /** 在允许执行工具之前原子保存身份，供重启后的停止和恢复复用。 */
  write(session_id: string, type: string, identity: SessionExecutionIdentity): Promise<void>;
}
