/**
 * SessionSystemMessage：Session 运行阶段使用的 system message。
 *
 * 关键点（中文）
 * - 该类型属于 Downcity Session，不依赖第三方 Provider。
 */

/** Session system 消息。 */
export interface SessionSystemMessage {
  /** 消息角色固定为 system。 */
  role: "system";
  /** 当前 system block 的文本内容。 */
  content: string;
}
