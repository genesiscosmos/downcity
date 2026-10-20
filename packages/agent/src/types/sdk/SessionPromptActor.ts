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

/** 单用户 City 中的本地用户身份；宿主的真实用户输入入口显式使用。 */
export const local_user_prompt_actor: SessionPromptActor = Object.freeze({ kind: "user", user_id: "local" });

/** 规范字段比较，避免对象属性顺序影响身份。 */
export function same_session_prompt_actor(left: SessionPromptActor, right: SessionPromptActor): boolean {
  if (left.kind === "user") return right.kind === "user" && left.user_id === right.user_id;
  if (left.kind === "runtime") return right.kind === "runtime" && left.namespace === right.namespace && left.object_id === right.object_id;
  return right.kind === "session" && left.agent_id === right.agent_id
    && left.workspace_id === right.workspace_id && left.session_id === right.session_id
    && left.origin_type === right.origin_type;
}
