/**
 * Agent 会话可用的 Session 工具输入 Schema。
 *
 * 职责说明（中文）
 * - 单一 session 工具通过 action 选择开一条、看状态、代答或收回。
 * - Schema 在模型输入边界完成校验，非法输入不会变成待处理状态。
 */

import { z } from "zod";

/** 模型侧统一入口；各动作参数在分发前使用对应 Schema 严格校验。 */
export const session_tool_input = z.strictObject({
  action: z.enum(["start", "check", "reply", "stop"]).optional().describe(
    "Session action. Omit to list available actions and their input schemas.",
  ),
  args: z.record(z.string(), z.unknown()).optional().describe("Arguments for the selected session action."),
});

/** `session.start` 输入：开一条会话并交给它任务。 */
export const session_start_input = z
  .object({
    workspace_id: z.string().trim().min(1).describe(
      "Target project Workspace ID. Obtain it from context.workspaces.list; do not use the main session's private Workspace.",
    ),
    query: z.string().trim().min(1).describe(
      "The task handed to the new session. Write it as a complete instruction: the new session only sees this text.",
    ),
    title: z.string().trim().min(1).optional().describe(
      "Optional short title for this piece of work, used when listing sessions.",
    ),
  })
  .strict();

/** `session.check` 输入：列出全部会话，或读取其中一条。 */
export const session_check_input = z
  .object({
    session_id: z.string().trim().min(1).optional().describe(
      "Read one session in detail. Omit to list every session of this agent and their current state.",
    ),
    limit: z.number().int().min(1).max(100).optional().describe(
      "Maximum sessions or messages to return. Defaults to 20.",
    ),
  })
  .strict();

/** `session.reply` 输入：代答某条会话正在等待的用户响应。 */
export const session_reply_input = z
  .object({
    session_id: z.string().trim().min(1).describe(
      "The session that raised the pending interaction.",
    ),
    interaction_id: z.string().trim().min(1).describe(
      "Pending interaction id, as returned by session({ action: 'check' }).",
    ),
    outcome: z.enum(["resolved", "denied"]).describe(
      "resolved approves or answers; denied rejects the operation.",
    ),
    payload: z.record(z.string(), z.unknown()).optional().describe(
      "Business response body for this interaction type. Question interactions require answers; approval interactions accept a decision.",
    ),
    note: z.string().trim().min(1).optional().describe(
      "Optional human-readable explanation passed along with the response.",
    ),
  })
  .strict();

/** `session.stop` 输入：收回某条会话。 */
export const session_stop_input = z
  .object({
    session_id: z.string().trim().min(1).describe("The session to stop."),
  })
  .strict();
