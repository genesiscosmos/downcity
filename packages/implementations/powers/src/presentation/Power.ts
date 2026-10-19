/** Presentation Power：校验完整声明式界面，并通过标准 Action 消息输出发布。 */
import { Power, create_action, type PowerActions } from "@downcity/city/power";
import { validate_session_power_content } from "@downcity/type";
import { z } from "zod";
import { parse_presentation_content, presentation_catalog_prompt } from "./OpenUICatalog.js";
import type { PresentationShowInput } from "./types/Presentation.js";

/** 正文交互界面能力；不拥有 Session、模型或用户视图状态。 */
export class PresentationPower extends Power {
  /** 稳定工具身份与消息归属。 */
  readonly name = "presentation";
  /** 用户可见能力名称。 */
  readonly title = "Presentation";
  /** 模型与用户可见的用途说明。 */
  readonly description = "Display rich OpenUI layouts, charts, tables and interactive forms directly in the reply.";
  /** 完整描述的唯一发布动作。 */
  readonly actions: PowerActions = {
    show: create_action({
      description: "Publish one complete interface in the current reply. On success it is already delivered; do not regenerate it for confirmation. Only call again for a distinct remaining deliverable or an explicit user revision.",
      returns: "published, summary, next_step. A successful publication needs no further rendering call; finish the reply when the user's requested content is complete.",
      access: "read",
      input_schema: {
        zod: z.object({ content: z.string().min(1), fallback_text: z.string().trim().min(1) }).strict(),
        json_schema: { type: "object", properties: { content: { type: "string", description: "OpenUI Lang. Write root first, use the registered component signatures." }, fallback_text: { type: "string" } }, required: ["content", "fallback_text"], additionalProperties: false },
      },
      execute({ input }) {
        const payload = input as unknown as PresentationShowInput;
        parse_presentation_content(payload.content);
        const part = {
          type: "power" as const,
          power_id: "presentation",
          schema_version: 2,
          data: { format: "openui-lang", catalog_id: "downcity.presentation.openui.v1", content: payload.content },
          fallback_text: payload.fallback_text,
        };
        validate_session_power_content(part);
        return {
          success: true,
          data: {
            published: true,
            summary: payload.fallback_text,
            next_step: "This interface has been published to the reply. Do not regenerate or re-send the same content. If the user's requested content is complete, finish with a brief text response; otherwise produce only the distinct remaining content. User interaction does not require keeping this turn running.",
          },
          message: "Interface published successfully. No additional show call is needed for this content.",
          messages: [{ role: "agent", parts: [part] }],
        };
      },
    }),
  };

  /** 模型能力说明与目录共用同一 Schema 来源。 */
  async system(): Promise<string> { return presentation_catalog_prompt(); }
}
