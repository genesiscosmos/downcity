/**
 * Session 来源元数据。
 *
 * Session 仍然归 Agent 所有；来源只说明它由用户直接创建，
 * 还是由某个 Group 为成员协作创建，不改变 Session 的所有权。
 */

/** Session 的创建来源。 */
export type SessionOrigin =
  | {
      /** 来源类型。 */
      readonly type: "user";
    }
  | {
      /** 来源类型。 */
      readonly type: "group";
      /** 创建该成员 Session 的 Group 稳定标识。 */
      readonly group_id: string;
      /** 创建该成员 Session 的 GroupSession 稳定标识。 */
      readonly group_session_id: string;
    };
