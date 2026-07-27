/**
 * Session Command 构造类型。
 *
 * Command 只存在于 Session 运行进程内，不属于 Remote Transport 协议，也不持久化。
 */

/** Session Command 构造参数。 */
export interface SessionCommandOptions {
  /** Command 出队后执行的完整行为。 */
  execute: () => Promise<void>;
  /** Session stop 时取消该 Command 的可选行为；未提供时 Command 继续保留。 */
  cancel?: () => void;
  /** Command 成功执行后需要持久化的完成信息；未提供时静默完成。 */
  completion?: SessionCommandCompletion;
}

/** Session Command 成功执行后的 canonical 持久化信息。 */
export interface SessionCommandCompletion {
  /** 完成信息固定持久化为 Action Message。 */
  type: "action";
  /** Action Message 使用的稳定业务标识。 */
  id: string;
  /** Action Message 展示的用户可读标题。 */
  title: string;
  /** Action Message 展示的可选结果说明。 */
  description?: string;
}
