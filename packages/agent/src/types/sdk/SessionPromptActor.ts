/** Session 普通输入的可信调用对象；身份由宿主绑定，不接受模型自行指定。 */
import { z } from "zod";

import type { SessionPromptActor } from "@downcity/type";
export type { SessionPromptActor } from "@downcity/type";

/** 统一验证进程内与传输输入，拒绝缺失身份及额外身份字段。 */
export const session_prompt_actor_schema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user"), user_id: z.string().trim().min(1) }).strict(),
  z.object({
    kind: z.literal("session"),
    agent_id: z.string().trim().min(1),
    workspace_id: z.string().trim().min(1).nullable(),
    session_id: z.string().trim().min(1),
    origin_type: z.string().trim().min(1),
  }).strict(),
  z.object({ kind: z.literal("runtime"), namespace: z.string().trim().min(1), object_id: z.string().trim().min(1) }).strict(),
]);

/** 单用户 City 中的本地用户身份；省略 `actor` 的 prompt 默认使用它。 */
export const local_user_prompt_actor: SessionPromptActor = Object.freeze({ kind: "user", user_id: "local" });

/** 构造用户对象；`user_id` 必须是稳定身份，不能用窗口或聊天路由 ID 代替。 */
export function create_user_prompt_actor(user_id: string): SessionPromptActor {
  return { kind: "user", user_id: String(user_id || "").trim() };
}

/** 构造来源 Session 对象；无项目工作区时传 null。 */
export function create_session_prompt_actor(input: {
  /** 来源 Agent 标识。 */ agent_id: string;
  /** 来源 Workspace 标识；无工作区时为 null。 */ workspace_id: string | null;
  /** 来源 Session 标识。 */ session_id: string;
  /** 来源 Session 存储分区。 */ origin_type: string;
}): SessionPromptActor {
  return {
    kind: "session",
    agent_id: input.agent_id,
    workspace_id: input.workspace_id,
    session_id: input.session_id,
    origin_type: input.origin_type,
  };
}

/** 构造宿主自动执行对象；不得用它冒用用户或 Session 身份。 */
export function create_runtime_prompt_actor(input: {
  /** 执行领域，例如 task、group。 */ namespace: string;
  /** 允许持续注入的稳定执行对象标识。 */ object_id: string;
}): SessionPromptActor {
  return { kind: "runtime", namespace: input.namespace, object_id: input.object_id };
}

/** 规范字段比较，避免对象属性顺序影响身份。 */
export function same_session_prompt_actor(left: SessionPromptActor, right: SessionPromptActor): boolean {
  if (left.kind === "user") return right.kind === "user" && left.user_id === right.user_id;
  if (left.kind === "runtime") return right.kind === "runtime" && left.namespace === right.namespace && left.object_id === right.object_id;
  return right.kind === "session" && left.agent_id === right.agent_id
    && left.workspace_id === right.workspace_id && left.session_id === right.session_id
    && left.origin_type === right.origin_type;
}
