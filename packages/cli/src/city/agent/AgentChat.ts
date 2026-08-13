/**
 * `city agent chat` 统一入口。
 *
 * 关键点（中文）
 * - 统一覆盖交互式持续对话与一次性消息模式，不再保留独立 `quest` 命令。
 * - 目标 Agent 始终按持久化 Agent 配置解析，不依赖当前工作目录。
 * - 默认使用独立 local-cli 主会话：`local-cli-chat-main`。
 * - 远程访问统一走 `RemoteAgent({ url })`，不再在 CLI 侧维护第二套 HTTP SDK transport。
 * - 远程连接、session 创建/列表等操作委托给 `AgentChatRemote.ts`。
 */

import { emitCliBlock } from "@/shared/CliReporter.js";
import { run_agent_chat_tui } from "@/city/agent/AgentChatTui.js";
import type { AgentChatCliOptions } from "@/city/agent/AgentChatTypes.js";
import {
  normalizeChatMessage,
  resolveAgentChatSessionOptions,
  resolveChatTargetAgentId,
  resolveInteractiveChatSession,
  runOneShotChat,
} from "@/city/agent/AgentChatHelpers.js";

/**
 * `city agent chat` 统一入口。
 */
export async function chatCommand(options: AgentChatCliOptions): Promise<void> {
  const resolved_session = resolveAgentChatSessionOptions(options);
  if (!resolved_session.success) {
    emitCliBlock({
      tone: "error",
      title: "Invalid chat session options",
      note: resolved_session.error,
    });
    return;
  }

  const agent_id = await resolveChatTargetAgentId(options.to);
  if (!agent_id) return;

  const oneShotMessage = normalizeChatMessage(String(options.message || ""));
  if (oneShotMessage) {
    await runOneShotChat({
      agent_id,
      message: oneShotMessage,
      options,
    });
    return;
  }

  if (options.json === true) {
    emitCliBlock({
      tone: "error",
      title: "JSON mode requires --message",
      note: "Use `city agent chat --message <text> --json` for one-shot structured output.",
    });
    return;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    emitCliBlock({
      tone: "error",
      title: "Interactive terminal required",
      note: "Use this command in a local terminal with TTY support, or pass `--message` for one-shot mode.",
    });
    return;
  }

  const interactive = await resolveInteractiveChatSession({
    agent_id,
    options,
    transport: {
      host: options.host,
      port: options.port,
    },
  });
  if (!interactive.success) {
    if (interactive.error) {
      emitCliBlock({
        tone: "error",
        title: "Agent chat failed",
        note: interactive.error,
      });
    }
    return;
  }

  try {
    await run_agent_chat_tui({
      agent_id: agent_id,
      session_id: interactive.target.session_id,
      remote_agent: interactive.remote_agent,
    });
  } finally {
    await interactive.remote_agent.close();
  }
}
