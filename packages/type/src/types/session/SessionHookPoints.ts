/**
 * Session 公开的稳定 Hook 检查点。
 *
 * 关键点（中文）
 * - 检查点由 Session 定义并触发；Power 只选择是否注册处理器。
 * - 该常量是 Agent 与 Power 必须就同一组名字达成一致的协议，因此定义在
 *   共享定义层，不归属任何实现包。
 */

/** Session 运行时的 Hook point 目录。 */
export const SESSION_HOOK_POINTS = Object.freeze({
  /** 建立 Session system snapshot 时允许 Hook 追加命名 blocks。 */
  system_context: "session.system_context",

  /** 当前 Turn 首次组装模型输入时允许 Hook 追加低权限参考 blocks。 */
  turn_context: "session.turn_context",

  /** canonical Turn 完成提交后通知 Hook 执行副作用。 */
  turn_committed: "session.turn_committed",
} as const);
