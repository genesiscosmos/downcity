/**
 * `city agent chat` 命令辅助函数。
 *
 * 关键点（中文）
 * - 统一覆盖交互式持续对话与一次性消息模式，不再保留独立 `quest` 命令。
 * - 目标 Agent 始终按持久化 Agent 配置解析，不依赖当前工作目录。
 * - 无显式选择时跟随最近会话所属 Workspace；没有历史会话才在当前 Workspace 新建。
 * - 会话发现走 Agent 级只读读取器，读写仍必须进入确定的 Workspace。
 * - 远程访问统一走 `RemoteAgent({ url })`，连接与会话操作委托给 `AgentChatRemote.ts`。
 */

import prompts from "@/city/tui/Prompts.js";
import {
  type RemoteAgentSession,
  type SessionMutation,
} from "@downcity/agent";
import { emitCliBlock } from "@/shared/CliReporter.js";
import { printResult } from "@/city/utils/cli/CliOutput.js";
import {
  format_agent_display_label,
  list_registered_agents_for_cli,
  resolve_cli_agent_target,
  resolve_cli_workspace,
  type AgentExecutionTarget,
} from "@/city/agent/AgentSelection.js";
import {
  buildAgentChatFailureText,
  createAgentSessionReader,
  createRemoteAgent,
  createRemoteChatSession,
  listRemoteChatSessions,
  type AgentChatClient,
} from "@/city/agent/AgentChatRemote.js";
import type {
  AgentChatCliOptions,
  AgentChatExecutionOutcome,
  AgentChatSessionOptions,
  AgentChatSessionSummaryView,
} from "@/city/agent/AgentChatTypes.js";

/**
 * 一次 chat 执行解析后的入口目标。
 */
export type ResolvedAgentChatTarget = {
  /** 目标 agent id。 */
  agent_id: string;
  /** 本次执行进入的 Workspace ID。 */
  workspace_id: string;
  /** 本次执行进入的 Workspace 绝对路径。 */
  project_root: string;
  /** 当前 chat 使用的 session_id。 */
  session_id: string;
};

export function normalizeChatMessage(input: string): string {
  return String(input || "").trim();
}

/**
 * 解析 `city agent chat` 的显式 session 选择语义。
 *
 * 关键点（中文）
 * - 无显式选择时返回空 session，由入口解析器跟随最近会话。
 * - `--session-id` 与 `--new-session` 互斥，避免“复用”和“新建”语义冲突。
 */
export function resolveAgentChatSessionOptions(
  input?: AgentChatSessionOptions,
):
  | {
      success: true;
      /** 显式指定的 session_id；为空表示未指定。 */
      explicit_session_id: string;
      /** 是否要求创建全新的 session。 */
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

  return {
    success: true,
    explicit_session_id,
    create_new_session: should_create_new_session,
  };
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
      title: "No registered agents",
      note: "Run `city agent create <workspace_path>` first.",
    });
    return null;
  }

  const response = (await prompts({
    type: "select",
    name: "agent_id",
    message: "选择要聊天的 Agent",
    choices: registered_agents.map((agent) => ({
      title: format_agent_display_label(agent),
      description: agent.status === "loaded" ? "City active" : "City inactive",
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

/**
 * 解析一次 chat 的入口目标，并返回已绑定正确 Workspace 的远程客户端。
 *
 * 关键点（中文）
 * - 显式 `--session-id` 必须存在，并按该 Session 的 Workspace 进入。
 * - 无显式选择时跟随最近 chat Session 所属 Workspace。
 * - 只有在没有任何历史会话时，才在 `--workspace` 或当前目录 Workspace 中新建 Session。
 * - Session 所属 Workspace 已注销时回落到入口 Workspace 并新建会话。
 */
export async function resolveAgentChatEntry(params: {
  agent_id: string;
  options: AgentChatCliOptions;
  transport?: { host?: string; port?: number };
}): Promise<
  | {
      success: true;
      target: ResolvedAgentChatTarget;
      remote_agent: AgentChatClient;
    }
  | {
      success: false;
      error?: string;
    }
> {
  const agent_id = String(params.agent_id || "").trim();
  if (!agent_id) return { success: false, error: "Missing target agent id." };

  const selected = resolveAgentChatSessionOptions(params.options);
  if (!selected.success) return { success: false, error: selected.error };

  try {
    return await open_agent_chat_entry({
      agent_id: agent_id,
      selected: selected,
      options: params.options,
      transport: params.transport,
    });
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** 打开 chat 入口；失败时抛出，由公开入口统一转为结果。 */
async function open_agent_chat_entry(params: {
  agent_id: string;
  selected: { explicit_session_id: string; create_new_session: boolean };
  options: AgentChatCliOptions;
  transport?: { host?: string; port?: number };
}): Promise<
  | {
      success: true;
      target: ResolvedAgentChatTarget;
      remote_agent: AgentChatClient;
    }
  | {
      success: false;
      error?: string;
    }
> {
  const agent_id = params.agent_id;
  const explicit_workspace = String(params.options.workspace || "").trim();
  const discovery = { agent_id: agent_id, transport: params.transport };

  let session_id = "";
  let workspace_id = "";
  let create_new_session = params.selected.create_new_session;

  if (!create_new_session && params.selected.explicit_session_id) {
    const session = await find_chat_session({
      ...discovery,
      session_id: params.selected.explicit_session_id,
    });
    if (!session) {
      return { success: false, error: `Session not found: ${params.selected.explicit_session_id}` };
    }
    if (explicit_workspace && session.workspace_id && session.workspace_id !== explicit_workspace) {
      return {
        success: false,
        error: `Session "${session.session_id}" belongs to Workspace "${session.workspace_id}", which does not match --workspace "${explicit_workspace}".`,
      };
    }
    if (!session.workspace_id) {
      return {
        success: false,
        error: `Session "${session.session_id}" is not bound to a Workspace.`,
      };
    }
    session_id = session.session_id;
    workspace_id = session.workspace_id;
  } else if (!create_new_session) {
    // 未指定 `--workspace` 时跟随最近会话所属 Workspace；显式指定时只在该 Workspace 内查找。
    const scoped_workspace_id = explicit_workspace
      ? (await resolve_cli_workspace(explicit_workspace)).workspace_id
      : undefined;
    const latest = await find_latest_chat_session({
      ...discovery,
      ...(scoped_workspace_id ? { workspace_id: scoped_workspace_id } : {}),
    });
    if (latest?.workspace_id) {
      session_id = latest.session_id;
      workspace_id = latest.workspace_id;
    } else {
      create_new_session = true;
    }
  }

  const target = await resolve_chat_entry_target({
    agent_id: agent_id,
    workspace_id: workspace_id,
    fallback_workspace_input: explicit_workspace,
  });
  const remote_agent = await createRemoteAgent({
    agent_id: target.agent_id,
    workspace: target.workspace_id,
    transport: params.transport,
  });

  if (create_new_session) {
    try {
      session_id = (await createRemoteChatSession({ remote_agent })).session_id;
    } catch (error) {
      await remote_agent.close().catch(() => undefined);
      throw error;
    }
  }

  return {
    success: true,
    target: {
      agent_id: target.agent_id,
      workspace_id: target.workspace_id,
      project_root: target.workspace_path,
      session_id: session_id,
    },
    remote_agent,
  };
}

/**
 * 解析本次 chat 要进入的 Workspace。
 *
 * 说明（中文）
 * - 优先使用 Session 绑定的 Workspace；该 Workspace 已注销时回落到入口 Workspace。
 * - 入口 Workspace 由 `--workspace`、当前目录或唯一已登记 Workspace 决定。
 */
async function resolve_chat_entry_target(params: {
  agent_id: string;
  workspace_id: string;
  fallback_workspace_input: string;
}): Promise<AgentExecutionTarget> {
  const preferred = String(params.workspace_id || "").trim();
  if (preferred) {
    try {
      return await resolve_cli_agent_target(params.agent_id, preferred);
    } catch {
      // Session 绑定的 Workspace 已注销：回落到入口 Workspace。
    }
  }
  return await resolve_cli_agent_target(params.agent_id, params.fallback_workspace_input);
}

/** 读取指定 Agent 的 chat Session；省略 `workspace_id` 时不限定 Workspace。 */
async function read_agent_chat_sessions(params: {
  agent_id: string;
  session_id?: string;
  workspace_id?: string;
  transport?: { host?: string; port?: number };
}): Promise<AgentChatSessionSummaryView[]> {
  const reader = await createAgentSessionReader({
    agent_id: params.agent_id,
    transport: params.transport,
  });
  try {
    return await listRemoteChatSessions({
      remote_agent: reader,
      input: {
        ...(params.workspace_id ? { workspace_id: params.workspace_id } : {}),
        ...(params.session_id ? { query: params.session_id } : {}),
      },
    });
  } finally {
    await reader.close().catch(() => undefined);
  }
}

/**
 * 在全部 Workspace 中查找最近一次 chat Session。
 *
 * 说明（中文）
 * - Session 列表已按 `updated_at` 倒序，首项即最近会话。
 * - 发现失败时返回 null，由调用方回落到入口 Workspace 新建会话。
 */
async function find_latest_chat_session(params: {
  agent_id: string;
  workspace_id?: string;
  transport?: { host?: string; port?: number };
}): Promise<AgentChatSessionSummaryView | null> {
  try {
    const sessions = await read_agent_chat_sessions(params);
    return sessions[0] ?? null;
  } catch {
    return null;
  }
}

/** 在全部 Workspace 中按 session_id 查找 chat Session。 */
async function find_chat_session(params: {
  agent_id: string;
  session_id: string;
  transport?: { host?: string; port?: number };
}): Promise<AgentChatSessionSummaryView | null> {
  const sessions = await read_agent_chat_sessions({
    agent_id: params.agent_id,
    session_id: params.session_id,
    transport: params.transport,
  });
  return sessions.find((item) => item.session_id === params.session_id) ?? null;
}

export async function runSdkPromptTurn(params: {
  agent_id: string;
  workspace?: string;
  message: string;
  sessionOptions?: AgentChatSessionOptions;
  transport?: { host?: string; port?: number };
  renderText?: boolean;
}): Promise<{
  success: boolean;
  error?: string;
  emittedVisibleText: boolean;
  session_id: string;
  project_root?: string;
  text?: string;
}> {
  const message = normalizeChatMessage(params.message);
  if (!message) {
    return {
      success: false,
      error: "Chat message is required.",
      emittedVisibleText: false,
      session_id: "",
      text: "",
    };
  }

  const entry = await resolveAgentChatEntry({
    agent_id: params.agent_id,
    options: {
      workspace: params.workspace,
      session_id: params.sessionOptions?.session_id,
      newSession: params.sessionOptions?.newSession,
    },
    transport: params.transport,
  });
  if (!entry.success) {
    return {
      success: false,
      error: entry.error,
      emittedVisibleText: false,
      session_id: "",
      text: "",
    };
  }

  const remote_agent = entry.remote_agent;
  let session: RemoteAgentSession;
  try {
    session = await remote_agent.sessions.get(entry.target.session_id);
  } catch (error) {
    await remote_agent.close().catch(() => undefined);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      emittedVisibleText: false,
      session_id: entry.target.session_id,
      project_root: entry.target.project_root,
      text: "",
    };
  }

  let printed_leading_newline = false;
  let emitted_visible_text = false;
  let final_text = "";
  let target_turn_id = "";
  const pending_events: SessionMutation[] = [];

  const renderEvent = (event: SessionMutation): void => {
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
    const turn = await session.prompt({ query: message });
    target_turn_id = turn.id;

    for (const event of pending_events) {
      const event_turn_id = "turn_id" in event ? event.turn_id : undefined;
      if (event_turn_id && event_turn_id !== target_turn_id) continue;
      renderEvent(event);
    }

    const result = await turn.finished;
    final_text = result.text;

    if (printed_leading_newline) {
      process.stdout.write("\n\n");
    }

    return {
      success: result.success,
      ...(result.error ? { error: result.error } : {}),
      emittedVisibleText: emitted_visible_text,
      session_id: entry.target.session_id,
      project_root: entry.target.project_root,
      text: final_text,
    };
  } catch (error) {
    if (printed_leading_newline) {
      process.stdout.write("\n\n");
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      emittedVisibleText: emitted_visible_text,
      session_id: entry.target.session_id,
      project_root: entry.target.project_root,
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
  workspace?: string;
  message: string;
  sessionOptions?: AgentChatSessionOptions;
  transport?: { host?: string; port?: number };
}): Promise<AgentChatExecutionOutcome> {
  const message = normalizeChatMessage(params.message);
  if (!message) {
    return {
      agent_id: String(params.agent_id || "").trim(),
      session_id: "",
      success: false,
      error: "Chat message is required.",
    };
  }

  const outcome = await runSdkPromptTurn({
    agent_id: params.agent_id,
    workspace: params.workspace,
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
      workspace: params.options.workspace,
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
      type: "block",
      asJson: true,
      success: outcome.success,
      title: "agent chat",
      data: {
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
    workspace: params.options.workspace,
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
