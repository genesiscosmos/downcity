/**
 * canonical Message 到实时 Session Mutation 的唯一构造入口。
 *
 * 关键点（中文）
 * - Mutation 的 wire 形状只在本模块定义一次；调用方提供 revision 与 created_at，不手写字段。
 * - Message 与 Part 的 Mutation 都是判别联合：`role` / `type` 必须与载荷同源。这里用显式
 *   分派让编译器验证这一约束，而不是用类型断言关闭检查。
 */

import type {
  SessionAgentMessagePart,
  SessionDeltaMutation,
  SessionMessage,
  SessionMessageMutation,
  SessionPartMutation,
} from "@downcity/type";

/** Part Mutation 的公共输入。 */
interface SessionPartMutationInput {
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
}

/** Delta Mutation 的公共输入。 */
interface SessionDeltaMutationInput {
  /** 当前 Mutation 的稳定唯一标识。 */
  mutation_id: string;
  /** 当前 Mutation 所属 Session 标识。 */
  session_id: string;
  /** 当前 Delta 所属 Message 标识。 */
  message_id: string;
  /** 当前 Delta 所属 Turn 标识。 */
  turn_id?: string;
  /** 应用当前 Mutation 后的 Message revision。 */
  revision: number;
  /** 当前 Mutation 创建时间戳（ms）。 */
  created_at: number;
  /** 当前 Delta 所属 Part 标识。 */
  part_id: string;
  /** 本次新增的原始文本，不是累计全文。 */
  delta: string;
  /** Delta 归属的 Part 类型。 */
  type: "text" | "reasoning" | "tool_input";
  /** Tool 输入增量必须携带的 Tool Call 标识。 */
  tool_call_id?: string;
}

/** Message 快照 Mutation 的公共输入。 */
interface SessionMessageMutationInput {
  /** 当前 Mutation 的稳定唯一标识。 */
  mutation_id: string;
  /** 当前 Mutation 所属 Session 标识。 */
  session_id: string;
  /** 创建或更新后的完整 Message 快照。 */
  message: SessionMessage;
}

/** 构造 Part 创建或完整快照 Mutation。 */
export function create_session_part_mutation(
  input: SessionPartMutationInput,
): SessionPartMutation {
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
    default:
      return assert_never(part);
  }
}

/** 构造文本、推理或 Tool 输入的原始增量 Mutation。 */
export function create_session_delta_mutation(
  input: SessionDeltaMutationInput,
): SessionDeltaMutation {
  const base = {
    mutation_id: input.mutation_id,
    variant: "delta" as const,
    message_id: input.message_id,
    ...(input.turn_id ? { turn_id: input.turn_id } : {}),
    revision: input.revision,
    session_id: input.session_id,
    created_at: input.created_at,
    part_id: input.part_id,
    delta: input.delta,
  };
  if (input.type === "tool_input") {
    const tool_call_id = String(input.tool_call_id || "").trim();
    if (!tool_call_id) {
      throw new Error(
        `Tool input delta requires a tool_call_id: ${input.part_id}`,
      );
    }
    return { ...base, type: "tool_input", tool_call_id };
  }
  return { ...base, type: input.type };
}

/** 构造 Message 创建或完整快照更新 Mutation。 */
export function create_session_message_mutation(
  input: SessionMessageMutationInput,
): SessionMessageMutation {
  const message = input.message;
  const base = {
    mutation_id: input.mutation_id,
    variant: "message" as const,
    message_id: message.message_id,
    sequence: message.sequence,
    revision: message.revision,
    session_id: input.session_id,
    ...(message.turn_id ? { turn_id: message.turn_id } : {}),
    created_at: message.updated_at,
  };
  if (message.role === "agent") return { ...base, role: "agent", message };
  return { ...base, role: "user", message };
}

/** canonical 联合类型新增成员时强制构造层显式处理。 */
function assert_never(value: never): never {
  throw new Error(
    `Unsupported Session Mutation payload: ${String((value as { type?: unknown }).type)}`,
  );
}
