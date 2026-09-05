/**
 * Session system block 中立协议。
 *
 * Agent 负责组合这些 block，City Plugin 只能提供新的 block，不能直接修改
 * Session 保存的 canonical system snapshot。
 */

/** Session system block 的来源层级。 */
export type SessionSystemBlockSource =
  | "core"
  | "instruction"
  | "plugin"
  | "session";

/** Session system prompt 的单个命名组成块。 */
export interface SessionSystemBlock {
  /** 当前 block 的来源层级。 */
  readonly source: SessionSystemBlockSource;

  /** 当前 block 在来源层级内的稳定名称。 */
  readonly name: string;

  /** 已经归一化、可以直接进入模型输入的完整文本。 */
  readonly content: string;
}
