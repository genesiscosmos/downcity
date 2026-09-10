/**
 * Session Command 构造类型。
 *
 * Command 只存在于 Session 运行进程内，不属于 Remote Transport 协议，也不持久化。
 */

/** Session Command 的执行类别。 */
export type SessionCommandKind =
  /** Prompt Command 需要创建或加入一个 Turn。 */
  | "prompt"
  /** Maintenance Command 可以在 Session 空闲期独立执行。 */
  | "maintenance";

/** Session 有序输入队列中的 Command。 */
export interface SessionCommand {
  /** 当前 Command 的执行类别。 */
  kind: SessionCommandKind;
  /** Prompt 恢复执行时要求复用的稳定 Turn ID。 */
  turn_id?: string;
  /** Command 出队后执行的完整行为。 */
  execute: () => Promise<void>;
  /** Session stop 时取消该 Command 的可选行为；未提供时 Command 继续保留。 */
  cancel?: () => void;
  /** Command 成功执行后需要持久化的完成信息；未提供时静默完成。 */
  completion?: SessionCommandCompletion;
}

/** Session facade 创建 Command 时使用的输入。 */
export type SessionCommandOptions = SessionCommand;

/** Session Command 成功执行后的 canonical 持久化信息。 */
export interface SessionCommandCompletion {
  /** 完成信息固定持久化为 Agent Message 内的 Action Part。 */
  type: "action";
  /** Action Part 及其所属 Agent Message 共用的稳定业务标识。 */
  id: string;
  /** Action Part 展示的用户可读标题。 */
  title: string;
  /** Action Part 展示的可选结果说明。 */
  description?: string;
  /** Action Part 所属 Agent Message 持久化后是否发布对应 Session Mutation。 */
  publish_mutation?: boolean;
}
