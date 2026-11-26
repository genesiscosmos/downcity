/** Profile 仅为 User/Agent Agreement 的上下文投影，不提供独立写入协议。 */
export type ProfileScope =
  | { /** 平台唯一 User 范围。 */ scope: "user" }
  | { /** 当前专属 Agent 范围。 */ scope: "agent"; /** 真实 Agent 身份。 */ agent_id: string };
