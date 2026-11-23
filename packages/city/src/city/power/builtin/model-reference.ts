/** 多模态动作只接受 Downtown 结构化引用，不通过模型字符串推测来源。 */
import { z } from "zod";

/** 从模型目录原样选择来源与模型，鉴权绑定仍由 Town 执行时检查。 */
export const downtown_model_schema = z.strictObject({
  downtown: z.string().min(1).describe("Downtown ID from the model catalog."),
  id: z.string().min(1).describe("Original model ID from that Downtown."),
});

/** Agent、Session 可以选择 Downtown 或宿主直接登记的文本模型。 */
export const model_reference_schema = z.union([downtown_model_schema, z.strictObject({
  client: z.string().min(1).describe("Direct client source from the model catalog."),
  id: z.string().min(1).describe("Original model ID from that client."),
})]);
