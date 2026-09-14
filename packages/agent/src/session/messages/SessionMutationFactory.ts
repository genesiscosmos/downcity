/**
 * canonical Part 到 `part` Mutation 的唯一构造入口。
 *
 * Part 的 `type` 与载荷必须同源，`SessionPartMutation` 又是按 Part 类型展开的联合，
 * 所以这里按 `type` 显式分派，让编译器验证配对关系，而不是用断言关闭检查。
 * Message 与 delta Mutation 只有单一调用点，留在各自生产方内联构造。
 */

import type {
  SessionAgentMessagePart,
  SessionPartMutation,
} from "@downcity/type";

/** 构造 `part` 创建或完整快照 Mutation。 */
export function create_session_part_mutation(input: {
  /** 当前 Mutation 的稳定唯一标识。 */
  mutation_id: string;
  /** 当前 Mutation 所属 Session 标识。 */
  session_id: string;
  /** 当前 Part 所属 Message 标识。 */
  message_id: string;
  /** 当前 Part 所属 Turn 标识。 */
  turn_id?: string;
  /** 应用当前 Mutation 后的 Message revision。 */
  revision: number;
  /** 当前 Mutation 创建时间戳（ms）。 */
  created_at: number;
  /** 被创建或更新的完整 Part 快照。 */
  part: SessionAgentMessagePart;
}): SessionPartMutation {
  const base = {
    mutation_id: input.mutation_id,
    variant: "part" as const,
    message_id: input.message_id,
    ...(input.turn_id ? { turn_id: input.turn_id } : {}),
    revision: input.revision,
    session_id: input.session_id,
    created_at: input.created_at,
    part_id: input.part.part_id,
  };
  const part = input.part;
  switch (part.type) {
    case "text":
      return { ...base, type: "text", part };
    case "reasoning":
      return { ...base, type: "reasoning", part };
    case "tool":
      return { ...base, type: "tool", part };
    case "file":
      return { ...base, type: "file", part };
    case "data":
      return { ...base, type: "data", part };
    case "action":
      return { ...base, type: "action", part };
    case "error":
      return { ...base, type: "error", part };
  }
}
