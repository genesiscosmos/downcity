/**
 * Control execute by session helper。
 *
 * 关键点（中文）
 * - control 层只负责把请求转成 session prompt。
 * - chat / queue 等渠道语义由宿主显式注入的 plugin 自行实现。
 */

import type { AgentWorkspace } from "@downcity/agent/internal";
import type { ControlSessionExecuteAttachmentInput } from "@/city/agent/control/types/ControlSessionExecute.js";
import { buildExecuteInputText } from "@/city/agent/control/ExecuteInput.js";

/**
 * 在指定 session 中执行一轮请求。
 *
 * 说明（中文）
 * - 按普通 session 同步执行。
 */
export async function executeBySessionId(params: {
  agentState: AgentWorkspace;
  session_id: string;
  instructions: string;
  attachments?: ControlSessionExecuteAttachmentInput[];
}) {
  const session_id = String(params.session_id || "").trim();
  const instructions = String(params.instructions || "").trim();
  if (!session_id) throw new Error("Missing session_id");
  if (!instructions) throw new Error("Missing instructions");

  const executeInput = await buildExecuteInputText({
    project_root: params.agentState.workspace.path,
    data_path: params.agentState.data_path,
    session_id,
    instructions,
    attachments: params.attachments,
  });

  const session = params.agentState.sessions.runtime(session_id);
  const turn = await session.prompt({
    query: executeInput,
  });
  const result = await turn.finished;

  return {
    success: result.success,
    ...(result.error ? { error: result.error } : {}),
    userVisible: result.text.trim(),
    queued: false,
  };
}
