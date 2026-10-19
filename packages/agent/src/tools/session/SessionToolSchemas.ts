/**
 * Agent 会话可用的 Session 工具输入 Schema。
 *
 * 职责说明（中文）
 * - 单一 session 工具通过 action 选择开始、继续、查看、代答或停止目标 Agent 的工作会话。
 * - Schema 在模型输入边界完成校验，非法输入不会变成待处理状态。
 */

import { z } from "zod";

/** 模型侧统一入口；各动作参数在分发前使用对应 Schema 严格校验。 */
export const session_tool_input = z.strictObject({
  action: z.enum(["start", "send", "check", "messages", "archive", "reply", "stop"]).optional().describe(
    "Session action. Omit to list available actions and their input schemas.",
  ),
  args: z.record(z.string(), z.unknown()).optional().describe("Arguments for the selected session action."),
});

/** 各动作共用的目标 Agent 选择；省略时操作当前 Agent。 */
const target_agent_input = {
  agent_id: z.string().trim().min(1).optional().describe(
    "Target agent ID from agent.list. Omit to use the current agent. Keep this ID for subsequent calls on the returned session.",
  ),
};

/** `session.messages` 读取 canonical 原始消息；游标可向 compact 之前继续翻页。 */
export const session_messages_input = z.strictObject({
  ...target_agent_input,
  session_id: z.string().trim().min(1).describe("Session ID whose original messages should be read."),
  limit: z.number().int().min(1).max(100).optional().describe("Messages per page; defaults to 20."),
  before_sequence: z.number().int().min(1).optional().describe("Exclusive sequence boundary from next_before_sequence. Omit for the latest page; compact does not remove history."),
});

/** `session.archive` 归档空闲 Work 会话，不永久删除消息。 */
export const session_archive_input = z.strictObject({
  ...target_agent_input,
  session_id: z.string().trim().min(1).describe("Idle Work Session to archive. Running or queued Sessions must finish or stop first."),
});

/** `session.send` 输入：继续已有工作会话，执行结果自动回传。 */
export const session_send_input = z.strictObject({
  ...target_agent_input,
  session_id: z.string().trim().min(1).describe("Existing Work Session ID returned by session.start."),
  query: z.string().trim().min(1).describe("Additional instructions, material, or feedback for the existing session. Results return automatically; do not poll."),
});

/** `session.start` 输入：开一条会话并交给它任务。 */
export const session_start_input = z
  .object({
    ...target_agent_input,
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
    ...target_agent_input,
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
    ...target_agent_input,
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
    ...target_agent_input,
    session_id: z.string().trim().min(1).describe("The session to stop."),
  })
  .strict();
