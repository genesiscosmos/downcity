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
import { resolveAgentId } from "@/shared/IndexSupport.js";

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
  projectRoot: string,
  options: AgentHistoryCleanOptions,
): Promise<AgentHistoryCleanResult> {
  if (options.hard !== true) {
    throw new CliError({
      title: "Hard clean requires --hard",
      note: "History clean deletes runtime files for one session.",
      fix: "Add --hard after verifying --session-id or --channel/--chat-id.",
    });
  }

  const chat_result = await clean_chat_storage({
    root_path: projectRoot,
    ...(normalizeText(options.sessionId)
      ? { session_id: normalizeText(options.sessionId) }
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
  const sessionId = chat_result.session_id;
  if (!sessionId) {
    throw new CliError({
      title: "Cannot resolve target session",
      note: "Provide --session-id, or provide --channel and --chat-id for a known chat route.",
      fix: "Example: city agent history clean <path> --channel telegram --chat-id 8444574557 --hard",
    });
  }

  const workspace = new Workspace({ path: projectRoot });
  let removedSessionDir = false;
  try {
    const store = workspace.bind_agent(resolveAgentId(projectRoot));
    removedSessionDir = await store.remove_session(sessionId);
  } finally {
    await workspace.dispose();
  }

  const result: AgentHistoryCleanResult = {
    projectRoot: path.resolve(projectRoot),
    sessionId,
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
      { label: "Project", value: result.projectRoot },
      { label: "Session", value: result.sessionId },
      { label: "Session dir", value: result.removedSessionDir ? "removed" : "not found" },
      { label: "Chat dir", value: result.removedChatDir ? "removed" : "not found" },
      { label: "Route", value: result.removedRoute ? "removed" : "not found" },
    ],
  });
  return result;
}
