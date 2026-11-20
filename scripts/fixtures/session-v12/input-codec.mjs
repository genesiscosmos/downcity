/** Frozen published v12 protocol from 9a983f62a; offline conversion only. */
/**
 * Input Part 的持久化内容校验。
 *
 * 输入身份来自独立列，业务内容使用封闭的模型 User 内容集合；不接受 data、
 * 模型输出或已移除的媒体授权字段。请求记账沿用 prompt actor 的统一校验。
 */
import { z } from "../../../packages/agent/node_modules/zod/index.js";

import { session_prompt_actor_schema } from "./prompt-actor.mjs";


const input_content_schema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }).strict(),
  z.object({ type: z.literal("context"), tag: z.string(), context: z.string() }).strict(),
  z.object({
    type: z.literal("file"), media_type: z.string(), url: z.string(),
    filename: z.string().optional(), media_version: z.string().optional(),
  }).strict(),
]);

const input_payload_schema = z.object({
  input_id: z.string().min(1),
  kind: z.string().min(1),
  source: z.object({
    tool_call_id: z.string().optional(), turn_id: z.string().optional(),
  }).strict().optional(),
  content: z.array(input_content_schema),
  created_at: z.number().finite(),
  meta: z.object({
    from: session_prompt_actor_schema,
    powers: z.json().optional(),
    callback: z.json().optional(),
  }).strict().optional(),
}).strict();

/** 解码 Input 业务字段，并以表中的稳定身份构造完整 Part。 */
export function decode_session_input_part(
  row                       ,
  content                         ,
)                        {
  const result = input_payload_schema.safeParse(content);
  if (!result.success) {
    throw new Error(`Invalid persisted Session Part ${row.part_id} (input): ${result.error.message}`);
  }
  return {
    ...result.data,
    type: "input",
    part_id: row.part_id,
    sequence: row.sequence,
    ...(row.step_id ? { step_id: row.step_id } : {}),
  };
}
