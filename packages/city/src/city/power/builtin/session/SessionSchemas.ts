/**
 * Session Power 的动作输入 Schema；由 City 统一注册和校验。
 *
 * 职责说明（中文）
 * - 单一 session 工具通过 action 选择开始、继续、查看、代答或停止当前 Agent 自己的工作会话。
 * - Schema 在模型输入边界完成校验，非法输入不会变成待处理状态。
 */

import { z } from "zod";

/** `session.messages` 读取有界 canonical 历史预览；原文由 Part 动作分段读取。 */
export const session_messages_input = z.strictObject({
  session_id: z.string().trim().min(1).describe("Session ID whose original messages should be read, including archived history."),
  session_category: z.enum(["chat", "work"]).describe("Category returned by check; together with session_id identifies the target."),
  storage_id: z.string().uuid().optional().describe("Required for archived history: exact record UUID returned by check. Omit for the active address."),
  limit: z.number().int().min(1).max(100).optional().describe("Maximum messages per page; defaults to 20. The 64 KiB result budget may return fewer."),
  before_sequence: z.number().int().min(1).optional().describe("Exclusive sequence boundary from next_before_sequence. Omit for the latest page; compact does not remove history."),
});

/** 单条消息内的 Part 列表及选定字段的原文片段，复用 canonical 消息定位。 */
export const session_part_input = z.strictObject({
  session_id: z.string().trim().min(1).describe("Target Session; use check to obtain its category."),
  session_category: z.enum(["chat", "work"]),
  storage_id: z.string().uuid().optional().describe("Exact archived record UUID returned by check; omit for active history."),
  message_id: z.string().min(1).describe("Stable canonical message ID returned by messages or a source reference."),
  message_sequence: z.number().int().min(1).describe("Stable message sequence from the source reference."),
  part_id: z.string().min(1).optional().describe("Omit to list Parts; provide with field to read one original field."),
  after_part_sequence: z.number().int().min(0).optional().describe("Exclusive Part sequence cursor for the next Part page."),
  limit: z.number().int().min(1).max(40).optional().describe("Maximum Parts per page; defaults to 20 and is also byte bounded."),
  field: z.string().min(1).optional().describe("Exact top-level Part field, such as text, input, output, error or data. JSON fields are serialized as text."),
  offset: z.number().int().min(0).optional().describe("UTF-16 code-unit offset into the original field text; defaults to 0."),
  length: z.number().int().min(1).max(4096).optional().describe("Maximum UTF-16 code units; defaults to 2048. Follow next_offset to continue."),
}).refine(input => Boolean(input.part_id) === Boolean(input.field), {
  message: "part_id and field must be provided together",
});

/** `session.archive` 归档空闲 Work 会话，不永久删除消息。 */
export const session_archive_input = z.strictObject({
  operation_id: z.string().uuid().optional().describe("Original archive operation UUID for resuming its fixed persisted subtree plan after a partial failure."),
  root_storage_id: z.string().uuid().optional().describe("Expected original root record UUID; does not grant control permission."),
  session_id: z.string().trim().min(1).describe("Idle Work Session to archive. Running or queued Sessions must finish or stop first."),
});

/** `session.send` 输入：继续已有工作会话，执行结果自动回传。 */
export const session_send_input = z.strictObject({
  session_id: z.string().trim().min(1).describe("Existing Work Session ID returned by session.start."),
  query: z.string().trim().min(1).describe("Additional instructions, material, or feedback for the existing session. Results return automatically; do not poll."),
});

/** `session.start` 输入：开一条会话并交给它任务。 */
export const session_start_input = z
  .object({
    workspace_id: z.string().trim().min(1).describe(
      "Target project Workspace ID. Obtain it from context.workspaces.list; do not use the main session's private Workspace.",
    ),
    query: z.string().trim().min(1).describe(
      "Self-contained assignment with a specific goal, necessary context, scope, expected output, and completion criteria; the new session does not inherit the caller's conversation. When a Work Main delegates, describe one bounded work thread after understanding the complete task and dependencies. Do not forward the entire Main assignment unchanged.",
    ),
    model_id: z.string().trim().min(1).optional().describe(
      "Configured model ID for the new session, including its provider identity. Omit to use the current agent's default model.",
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
    session_category: z.enum(["chat", "work"]).optional().describe("Required when session_id is supplied; omit both to list this agent's sessions."),
    storage_id: z.string().uuid().optional().describe("Exact archived record UUID; requires session_id and session_category. Omit for active details."),
    limit: z.number().int().min(1).max(100).optional().describe(
      "Maximum sessions or messages to return. Defaults to 20.",
    ),
  })
  .strict()
  .refine((input) => Boolean(input.session_id) === Boolean(input.session_category), {
    message: "session_id and session_category must be provided together",
  }).refine(input => !input.storage_id || Boolean(input.session_id && input.session_category), {
    message: "storage_id requires session_id and session_category",
  });

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
      "Resolve or deny a question using the user's actual answer. Approval operations must use the user's approval interface.",
    ),
    payload: z.record(z.string(), z.unknown()).optional().describe(
      "Public question response body with answers from the user. Approval and private-input interactions must use the original Session's trusted interface.",
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
