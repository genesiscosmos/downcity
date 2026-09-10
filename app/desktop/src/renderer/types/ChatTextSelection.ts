/** Desktop Chat 消息正文选区的展示状态。 */
export interface ChatTextSelection {
  /** 被引用 canonical 消息的稳定标识。 */
  message_id: string;
  /** 被引用消息在会话中的身份。 */
  role: "user" | "agent";
  /** 用户实际框选并去除首尾空白后的文本。 */
  text: string;
  /** 浮动引用按钮在视口中的水平中心坐标。 */
  viewport_x: number;
  /** 浮动引用按钮在视口中的顶部坐标。 */
  viewport_y: number;
}
