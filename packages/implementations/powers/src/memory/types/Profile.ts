/** User 与 Agent Core Memory 的统一文档定位协议；Workspace 不提供常驻 Profile。 */
export type ProfileScope =
  | { /** 平台唯一使用者，跨 Agent 生效。 */ target: "user" }
  | {
      /** 当前 Agent 专属约定。 */
      target: "agent";
      /** 宿主登记的稳定 Agent 标识。 */
      agent_id: string;
    };
