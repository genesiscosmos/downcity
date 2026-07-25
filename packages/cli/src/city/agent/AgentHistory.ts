/**
 * AgentHistory：`city agent history` 维护命令。
 *
 * 关键点（中文）
 * - 面向用户提供定点硬清理能力，用于处理单个坏 session。
 * - 清理范围固定为 session messages、chat audit、channel route 三处。
 * - 命令必须显式传 `--hard`，避免误删运行时历史。
 */

import path from "node:path";
import { Workspace } from "@downcity/agent";
import { clean_chat_storage } from "@downcity/plugins/chat";
import { CliError } from "@/shared/CliError.js";
import type {
  AgentHistoryCleanOptions,
  AgentHistoryCleanResult,
} from "@/city/agent/AgentHistoryTypes.js";
import { emitCliBlock } from "@/shared/CliReporter.js";
import { printResult } from "@/city/utils/cli/CliOutput.js";
import type { DaemonTarget } from "@/city/process/daemon/Types.js";

function normalizeText(input: unknown): string {
  return String(input || "").trim();
}

function normalize_thread_id(input: unknown): number | undefined {
  const text = normalizeText(input);
  if (!text) return undefined;
  const numberValue = Number(text);
  if (!Number.isFinite(numberValue) || numberValue <= 0) return undefined;
  return Math.trunc(numberValue);
}

/**
 * 执行 `city agent history clean`。
 */
export async function agentHistoryCleanCommand(
  target: DaemonTarget,
  options: AgentHistoryCleanOptions,
): Promise<AgentHistoryCleanResult> {
  const project_root = target.workspace_path;
  if (options.hard !== true) {
    throw new CliError({
      title: "Hard clean requires --hard",
      note: "History clean deletes runtime files for one session.",
      fix: "Add --hard after verifying --session-id or --channel/--chat-id.",
    });
  }

  const chat_result = await clean_chat_storage({
    root_path: project_root,
    ...(normalizeText(options.session_id)
      ? { session_id: normalizeText(options.session_id) }
      : {}),
    ...(normalizeText(options.channel) ? { channel: normalizeText(options.channel) } : {}),
    ...(normalizeText(options.chatId) ? { chat_id: normalizeText(options.chatId) } : {}),
    ...(normalizeText(options.targetType)
      ? { target_type: normalizeText(options.targetType) }
      : {}),
    ...(normalize_thread_id(options.threadId)
      ? { thread_id: normalize_thread_id(options.threadId) }
      : {}),
  });
  const session_id = chat_result.session_id;
  if (!session_id) {
    throw new CliError({
      title: "Cannot resolve target session",
      note: "Provide --session-id, or provide --channel and --chat-id for a known chat route.",
      fix: "Example: city agent history clean <path> --channel telegram --chat-id 8444574557 --hard",
    });
  }

  const workspace = new Workspace({ path: project_root });
  let removedSessionDir = false;
  try {
    const store = workspace.bind_agent(target.agent_id);
    removedSessionDir = await store.remove_session(session_id);
  } finally {
    await workspace.dispose();
  }

  const result: AgentHistoryCleanResult = {
    project_root: path.resolve(project_root),
    session_id,
    removedSessionDir,
    removedChatDir: chat_result.removed_chat_dir,
    removedRoute: chat_result.removed_route,
  };

  if (options.json === true) {
    printResult({
      asJson: true,
      success: true,
      title: "agent history cleaned",
      payload: { ...result },
    });
    return result;
  }

  emitCliBlock({
    tone: "success",
    title: "Agent history cleaned",
    facts: [
      { label: "Project", value: result.project_root },
      { label: "Session", value: result.session_id },
      { label: "Session dir", value: result.removedSessionDir ? "removed" : "not found" },
      { label: "Chat dir", value: result.removedChatDir ? "removed" : "not found" },
      { label: "Route", value: result.removedRoute ? "removed" : "not found" },
    ],
  });
  return result;
}
