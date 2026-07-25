/**
 * `city agent chat` 命令辅助函数。
 *
 * 关键点（中文）
 * - 统一覆盖交互式持续对话与一次性消息模式，不再保留独立 `quest` 命令。
 * - 目标 agent 始终按 managed agent registry 名称解析，不依赖当前工作目录。
 * - 默认使用独立 local-cli 主会话：`local-cli-chat-main`。
 * - 远程访问统一走 `RemoteAgent({ url })`，不再在 CLI 侧维护第二套 HTTP SDK transport。
 * - 远程连接、session 创建/列表等操作委托给 `AgentChatRemote.ts`。
 */

import prompts from "@/city/tui/Prompts.js";
import {
  RemoteAgent,
  type SessionMutation,
} from "@downcity/agent";
import { emitCliBlock } from "@/shared/CliReporter.js";
import { printResult } from "@/city/utils/cli/CliOutput.js";
import {
  resolveProjectRootByAgentId,
  validateAgentProjectRoot,
} from "@/city/shared/PluginTargetSupport.js";
import { list_registered_agents_for_cli } from "@/city/agent/AgentSelection.js";
import {
  createAgentChatSessionId,
  createRemoteAgent,
  createRemoteChatSession,
  getOrCreateRemoteSession,
  buildAgentChatFailureText,
  listRemoteChatSessions,
} from "@/city/agent/AgentChatRemote.js";
import type {
  AgentChatCliOptions,
  AgentChatExecutionOutcome,
  AgentChatSessionOptions,
} from "@/city/agent/AgentChatTypes.js";
import {
  AGENT_CHAT_DEFAULT_SESSION_ID,
} from "@/city/agent/AgentChatTypes.js";
import type { AgentChatInteractiveRendererPort } from "@/city/types/AgentChatInteractive.js";

export type ResolvedAgentChatTarget = {
  /** 目标 agent id。 */
  agent_id: string;
  /** 目标项目根目录。 */
  project_root: string;
  /** 当前 chat 绑定的 session_id。 */
  session_id: string;
  /** 当前 chat 是否要求创建全新的 session。 */
  createNewSession: boolean;
};

export function normalizeChatMessage(input: string): string {
  return String(input || "").trim();
}

/**
 * 解析 `city agent chat` 的 session 选择语义。
 *
 * 关键点（中文）
 * - 默认继续使用 `local-cli-chat-main`，保持老命令行为稳定。
 * - `--new-session` 生成不可预测的新 ID，避免用户手动清理旧上下文。
 * - `--session-id` 与 `--new-session` 互斥，避免“复用”和“新建”语义冲突。
 */
export function resolveAgentChatSessionOptions(
  input?: AgentChatSessionOptions,
):
  | {
      success: true;
      session_id: string;
      create_new_session: boolean;
    }
  | {
      success: false;
      error: string;
    } {
  const explicit_session_id = String(input?.session_id || "").trim();
  const should_create_new_session = input?.newSession === true;

  if (explicit_session_id && should_create_new_session) {
    return {
      success: false,
      error: "`--session-id` and `--new-session` cannot be used together.",
    };
  }

  if (should_create_new_session) {
    return {
      success: true,
      session_id: createAgentChatSessionId(),
      create_new_session: true,
    };
  }

  return {
    success: true,
    session_id: explicit_session_id || AGENT_CHAT_DEFAULT_SESSION_ID,
    create_new_session: false,
  };
}

export function hasExplicitSessionSelection(input: AgentChatSessionOptions): boolean {
  return Boolean(String(input.session_id || "").trim() || input.newSession === true);
}

export async function resolveChatTargetAgentId(inputId?: string): Promise<string | null> {
  const explicit = String(inputId || "").trim();
  if (explicit) return explicit;

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    emitCliBlock({
      tone: "error",
      title: "Agent ID is required",
      note: "Use `city agent chat --to <id>` or run this command in an interactive terminal.",
    });
    return null;
  }

  const registered_agents = await list_registered_agents_for_cli();
  if (registered_agents.length === 0) {
    emitCliBlock({
      tone: "error",
      title: "No managed agents",
      note: "Run `city agent create <workspace_path>` first.",
    });
    return null;
  }

  const response = (await prompts({
    type: "select",
    name: "agent_id",
    message: "选择要聊天的 Agent",
    choices: registered_agents.map((agent) => ({
      title: agent.agent_id,
      description: `${agent.status} · ${agent.workspace_path}`,
      value: agent.agent_id,
    })),
    initial: 0,
  })) as { agent_id?: string };
  const agent_id = String(response.agent_id || "").trim();
  if (!agent_id) {
    emitCliBlock({
      tone: "info",
      title: "Agent chat cancelled",
    });
    return null;
  }
  return agent_id;
}

export async function resolveAgentChatTarget(
  agentIdInput: string,
  sessionOptions?: AgentChatSessionOptions,
): Promise<
  | {
      success: true;
      target: ResolvedAgentChatTarget;
    }
  | {
      success: false;
      outcome: AgentChatExecutionOutcome;
    }
> {
  const agent_id = String(agentIdInput || "").trim();
  const resolved_session = resolveAgentChatSessionOptions(sessionOptions);
  const session_id = resolved_session.success
    ? resolved_session.session_id
    : AGENT_CHAT_DEFAULT_SESSION_ID;
  if (!resolved_session.success) {
    return {
      success: false,
      outcome: {
        agent_id,
        session_id,
        success: false,
        error: resolved_session.error,
      },
    };
  }

  if (!agent_id) {
    return {
      success: false,
      outcome: {
        agent_id: "",
        session_id,
        success: false,
        error: "Missing target agent id.",
      },
    };
  }

  const resolved = await resolveProjectRootByAgentId(agent_id);
  if (!resolved.project_root) {
    return {
      success: false,
      outcome: {
        agent_id,
        session_id,
        success: false,
        error: resolved.error || "Failed to resolve agent project path",
      },
    };
  }

  const pathError = validateAgentProjectRoot(resolved.project_root);
  if (pathError) {
    return {
      success: false,
      outcome: {
        agent_id,
        project_root: resolved.project_root,
        session_id,
        success: false,
        error: pathError,
      },
    };
  }

  const registeredAgents = await list_registered_agents_for_cli();
  const registeredAgent = registeredAgents.find(
    (item) =>
      item.workspace_path === resolved.project_root || item.agent_id === agent_id,
  );
  if (registeredAgent && registeredAgent.status !== "running") {
    return {
      success: false,
      outcome: {
        agent_id,
        project_root: resolved.project_root,
        session_id,
        success: false,
        error: "Agent is not running. Run `city agent start` first.",
      },
    };
  }

  return {
    success: true,
    target: {
      agent_id,
      project_root: resolved.project_root,
      session_id,
      createNewSession: resolved_session.create_new_session,
    },
  };
}

export function printAssistantReply(replyText: string): void {
  const text = String(replyText || "").trim();
  if (!text) {
    emitCliBlock({
      tone: "info",
      title: "No visible reply",
      note: "The turn completed, but no user-visible text was returned.",
    });
    return;
  }
  console.log(`\n${text}\n`);
}

export function printAgentChatFailure(params: {
  agent_id: string;
  error?: string;
}): void {
  emitCliBlock({
    tone: "error",
    title: "Agent chat failed",
    facts: [
      {
        label: "agent",
        value: params.agent_id,
      },
      {
        label: "error",
        value: buildAgentChatFailureText(params.error),
      },
    ],
  });
}

export async function resolveInteractiveChatSession(params: {
  agent_id: string;
  options: AgentChatCliOptions;
  transport?: { host?: string; port?: number };
}): Promise<
  | {
      success: true;
      target: ResolvedAgentChatTarget;
      remote_agent: RemoteAgent;
    }
  | {
      success: false;
      error?: string;
    }
> {
  const preselected_session = resolveAgentChatSessionOptions(params.options);
  if (!preselected_session.success) {
    return {
      success: false,
      error: preselected_session.error,
    };
  }

  const resolved = await resolveAgentChatTarget(params.agent_id, {
    session_id: preselected_session.session_id,
    newSession: false,
  });
  if (!resolved.success) {
    return {
      success: false,
      error: resolved.outcome.error,
    };
  }
  resolved.target.createNewSession = preselected_session.create_new_session;

  const remote_agent = await createRemoteAgent({
    agent_id: resolved.target.agent_id,
    transport: params.transport,
  });

  if (hasExplicitSessionSelection(params.options)) {
    if (resolved.target.createNewSession) {
      const created = await createRemoteChatSession({
        remote_agent,
        session_id: preselected_session.session_id,
      });
      resolved.target.session_id = created.session_id;
      resolved.target.createNewSession = false;
    }
    return {
      success: true,
      target: resolved.target,
      remote_agent,
    };
  }

  // 关键点（中文）：未显式指定 session 时，直接复用最近活跃的会话，
  // 不再弹出 SessionPicker；没有任何历史会话时回落到默认 session。
  // 用户仍可在 TUI 内通过 /session 命令随时切换。
  const latest_session_id = await resolveLatestChatSessionId({ remote_agent });
  if (latest_session_id) {
    resolved.target.session_id = latest_session_id;
  }
  return {
    success: true,
    target: resolved.target,
    remote_agent,
  };
}

/**
 * 解析最近活跃的 chat session id。
 *
 * 说明（中文）
 * - 按 `updated_at` 取最新的会话；缺失 `updated_at` 视为最旧。
 * - 列表为空时返回 null，由调用方回落到默认 session。
 *
 * @param params.remote_agent 远程 agent 句柄。
 * @returns 最近活跃的 session id；无历史会话时为 null。
 */
async function resolveLatestChatSessionId(params: {
  remote_agent: RemoteAgent;
}): Promise<string | null> {
  let sessions: Awaited<ReturnType<typeof listRemoteChatSessions>>;
  try {
    sessions = await listRemoteChatSessions({ remote_agent: params.remote_agent });
  } catch {
    return null;
  }
  if (sessions.length === 0) {
    return null;
  }
  let latest = sessions[0];
  for (const candidate of sessions) {
    if ((candidate.updated_at ?? 0) > (latest.updated_at ?? 0)) {
      latest = candidate;
    }
  }
  return latest.session_id;
}

export async function runSdkPromptTurn(params: {
  agent_id: string;
  message: string;
  sessionOptions?: AgentChatSessionOptions;
  transport?: { host?: string; port?: number };
  renderText?: boolean;
  interactiveRenderer?: AgentChatInteractiveRendererPort;
}): Promise<{
  success: boolean;
  error?: string;
  emittedVisibleText: boolean;
  session_id: string;
  project_root?: string;
  text?: string;
}> {
  const message = normalizeChatMessage(params.message);
  const resolved_session = resolveAgentChatSessionOptions(params.sessionOptions);
  if (!message) {
    return {
      success: false,
      error: "Chat message is required.",
      emittedVisibleText: false,
      session_id: resolved_session.success
        ? resolved_session.session_id
        : AGENT_CHAT_DEFAULT_SESSION_ID,
      text: "",
    };
  }

  const resolved = await resolveAgentChatTarget(params.agent_id, params.sessionOptions);
  if (!resolved.success) {
    return {
      success: false,
      error: resolved.outcome.error,
      emittedVisibleText: false,
      session_id: resolved.outcome.session_id,
      ...(resolved.outcome.project_root ? { project_root: resolved.outcome.project_root } : {}),
      text: "",
    };
  }

  const remote_agent = await createRemoteAgent({
    agent_id: resolved.target.agent_id,
    transport: params.transport,
  });
  const session = await getOrCreateRemoteSession({
    remote_agent,
    session_id: resolved.target.session_id,
    create_new_session: resolved.target.createNewSession,
  });

  let printed_leading_newline = false;
  let emitted_visible_text = false;
  let final_text = "";
  let target_turn_id = "";
  const pending_events: SessionMutation[] = [];

  const renderEvent = (event: SessionMutation): void => {
    if (params.interactiveRenderer) {
      params.interactiveRenderer.render_event(event);
      return;
    }
    if (
      event.variant !== "delta" ||
      event.type !== "text" ||
      event.turn_id !== target_turn_id ||
      !event.delta
    ) {
      return;
    }
    if (params.renderText === false) return;
    if (!printed_leading_newline) {
      process.stdout.write("\n");
      printed_leading_newline = true;
    }
    process.stdout.write(event.delta);
    emitted_visible_text = true;
  };

  const unsubscribe = session.subscribe((event) => {
    if (!target_turn_id) {
      pending_events.push(event);
      return;
    }
    const event_turn_id = "turn_id" in event ? event.turn_id : undefined;
    if (event_turn_id && event_turn_id !== target_turn_id) return;
    renderEvent(event);
  });

  try {
    params.interactiveRenderer?.start_turn();
    const turn = await session.prompt({ query: message });
    target_turn_id = turn.id;
    params.interactiveRenderer?.attach_turn_id(target_turn_id);

    for (const event of pending_events) {
      const event_turn_id = "turn_id" in event ? event.turn_id : undefined;
      if (event_turn_id && event_turn_id !== target_turn_id) continue;
      renderEvent(event);
    }

    const result = await turn.finished;
    final_text = result.text;

    if (params.interactiveRenderer) {
      emitted_visible_text =
        params.interactiveRenderer.finish_turn().emitted_visible_text;
    } else if (printed_leading_newline) {
      process.stdout.write("\n\n");
    }

    return {
      success: result.success,
      ...(result.error ? { error: result.error } : {}),
      emittedVisibleText: emitted_visible_text,
      session_id: resolved.target.session_id,
      project_root: resolved.target.project_root,
      text: final_text,
    };
  } catch (error) {
    if (params.interactiveRenderer) {
      emitted_visible_text =
        params.interactiveRenderer.finish_turn().emitted_visible_text;
    } else if (printed_leading_newline) {
      process.stdout.write("\n\n");
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      emittedVisibleText: emitted_visible_text,
      session_id: resolved.target.session_id,
      project_root: resolved.target.project_root,
      text: final_text,
    };
  } finally {
    unsubscribe();
    await remote_agent.close();
  }
}

/**
 * 向目标 agent 的 SDK actor session 发送一轮消息。
 */
export async function executeAgentChatTurn(params: {
  agent_id: string;
  message: string;
  sessionOptions?: AgentChatSessionOptions;
  transport?: { host?: string; port?: number };
}): Promise<AgentChatExecutionOutcome> {
  const message = normalizeChatMessage(params.message);
  const resolved_session = resolveAgentChatSessionOptions(params.sessionOptions);
  const session_id = resolved_session.success
    ? resolved_session.session_id
    : AGENT_CHAT_DEFAULT_SESSION_ID;

  if (!message) {
    return {
      agent_id: String(params.agent_id || "").trim(),
      session_id,
      success: false,
      error: "Chat message is required.",
    };
  }

  const outcome = await runSdkPromptTurn({
    agent_id: params.agent_id,
    message,
    sessionOptions: params.sessionOptions,
    transport: params.transport,
    renderText: false,
  });

  return {
    agent_id: params.agent_id,
    ...(outcome.project_root ? { project_root: outcome.project_root } : {}),
    session_id: outcome.session_id,
    success: outcome.success,
    payload: {
      success: outcome.success,
      session_id: outcome.session_id,
      result: {
        success: outcome.success,
        userVisible: outcome.text || "",
        ...(outcome.error ? { error: outcome.error } : {}),
      },
      ...(outcome.error ? { error: outcome.error } : {}),
    },
    ...(outcome.error ? { error: outcome.error } : {}),
  };
}

export async function runOneShotChat(params: {
  agent_id: string;
  message: string;
  options: AgentChatCliOptions;
}): Promise<void> {
  if (params.options.json === true) {
    const outcome = await executeAgentChatTurn({
      agent_id: params.agent_id,
      message: params.message,
      sessionOptions: {
        session_id: params.options.session_id,
        newSession: params.options.newSession,
      },
      transport: {
        host: params.options.host,
        port: params.options.port,
      },
    });
    printResult({
      asJson: true,
      success: outcome.success,
      title: "agent chat",
      payload: {
        agent: params.agent_id,
        ...(outcome.project_root ? { project_root: outcome.project_root } : {}),
        session_id: outcome.session_id,
        ...(outcome.payload?.result ? { result: outcome.payload.result } : {}),
        ...(outcome.error ? { error: outcome.error } : {}),
      },
    });
    return;
  }

  const outcome = await runSdkPromptTurn({
    agent_id: params.agent_id,
    message: params.message,
    sessionOptions: {
      session_id: params.options.session_id,
      newSession: params.options.newSession,
    },
    transport: {
      host: params.options.host,
      port: params.options.port,
    },
  });

  if (!outcome.success) {
    printAgentChatFailure({
      agent_id: params.agent_id,
      error: outcome.error,
    });
    return;
  }

  if (!outcome.emittedVisibleText) printAssistantReply("");
}
