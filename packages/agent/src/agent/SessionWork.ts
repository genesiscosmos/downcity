/**
 * SessionWork：Agent 会话安排与观察其他会话的实现。
 *
 * 职责说明（中文）
 * - 把 AgentSessions 的能力投影成「一件活」的完整动作：开、看、答、停。
 * - 只读取公开的摘要与消息投影，不缓存会话，也不持有存储。
 *
 * 关键点（中文）
 * - 清单排除 Agent 自己的会话，否则清单里会出现「自己」。
 * - `spawn` 不等待 Turn 结束：派活的意义就是 Agent 会话立刻能继续。
 * - 详情按最近消息分页读取，让对话能回答「它做了什么」，而不把整段历史塞进上下文。
 */

import type { ListSessionMessagesInput, SessionMessagePage } from "@downcity/type";
import type { AgentArchiveSessionResult } from "@/types/agent/SessionTypes.js";
import type { SessionInteractionResponse } from "@downcity/type";
import type { SessionDelegationCaller, SessionDelegationInput, SessionDelegationMessage, SessionDelegationPort, SessionDelegationReceipt } from "@/types/agent/SessionDelegation.js";
import { is_agent_session_origin } from "@downcity/type";
import type { SessionWorkContract } from "@/types/agent/SessionWork.js";
import type {
  SessionCheckDetailToolOutput,
  SessionToolState,
  SessionToolSummary,
} from "@/types/tools/session/SessionTools.js";
import type { AgentSession } from "@/types/agent/SessionActor.js";

/** 清单默认返回的会话数量上限。 */
const DEFAULT_SESSION_LIMIT = 20;

/** 详情默认返回的最近消息条数。 */
const DEFAULT_MESSAGE_LIMIT = 20;

/** 清单中的一条会话列表项；由 AgentSessions 摘要投影而来。 */
export interface SessionWorkListEntry {
  /** 会话当前绑定的项目 Workspace 标识。 */
  workspace_id?: string;
  /** 会话稳定标识。 */
  session_id: string;
  /** 用户可见标题；未生成时省略。 */
  title?: string;
  /** 最近更新的预览文本。 */
  preview_text?: string;
  /** 最近更新时间戳（ms）。 */
  updated_at?: number;
  /** 会话来源。 */
  origin: { type: string };
  /** 当前是否正在执行。 */
  executing?: boolean;
}

/** SessionWork 构造参数。 */
export interface SessionWorkOptions {
  /** 拥有这些会话的 Agent 稳定标识。 */
  agent_id: string;
  /** 列出活动会话摘要，`limit` 由本模块归一化后传入。 */
  list_sessions: (input: { limit: number }) => Promise<{
    items: SessionWorkListEntry[];
  }>;
  /** 恢复单条会话的运行时实例。 */
  get_session: (session_id: string, origin_type: string) => Promise<AgentSession>;
  /** 持久化派发与结果回传端口；SessionWork 不持有委派存储。 */
  delegations: SessionDelegationPort;
}

/** Agent 会话的会话工作运行时。 */
export class SessionWork implements SessionWorkContract {
  private readonly options: SessionWorkOptions;

  constructor(options: SessionWorkOptions) {
    this.options = options;
  }

  /** 开一条工作会话并立刻把任务交给它。 */
  async spawn(input: SessionDelegationInput, caller: SessionDelegationCaller): Promise<SessionDelegationReceipt> {
    return await this.options.delegations.spawn(input, caller);
  }

  /** 继续已有的工作会话，复用持久化派发与结果回传。 */
  async send(input: SessionDelegationMessage, caller: SessionDelegationCaller): Promise<SessionDelegationReceipt> {
    await this.require_list_entry(input.session_id);
    return await this.options.delegations.send(input, caller);
  }

  /** 列出当前 Agent 除自己那条之外的全部会话。 */
  async list(input?: { limit?: number }): Promise<SessionToolSummary[]> {
    const page = await this.options.list_sessions({
      limit: normalize_limit(input?.limit, DEFAULT_SESSION_LIMIT),
    });
    const summaries: SessionToolSummary[] = [];
    for (const item of page.items) {
      if (is_agent_session_origin(item.origin)) continue;
      const pending_interaction_count = await this.count_pending(item);
      summaries.push({
        session_id: item.session_id,
        agent_id: this.options.agent_id,
        ...(item.workspace_id ? { workspace_id: item.workspace_id } : {}),
        ...(item.title ? { title: item.title } : {}),
        state: resolve_session_state({
          executing: item.executing === true,
          pending_interaction_count,
        }),
        ...(item.preview_text ? { preview_text: item.preview_text } : {}),
        ...(typeof item.updated_at === "number" ? { updated_at: item.updated_at } : {}),
        pending_interaction_count,
      });
    }
    return summaries;
  }

  /** 读取单条会话的摘要、最近消息与待响应 Interaction。 */
  async read(input: {
    session_id: string;
    limit?: number;
  }): Promise<SessionCheckDetailToolOutput> {
    const item = await this.require_list_entry(input.session_id);
    const session = await this.options.get_session(item.session_id, item.origin.type);
    const [messages, pending, status] = await Promise.all([
      session.messages({ limit: normalize_limit(input.limit, DEFAULT_MESSAGE_LIMIT) }),
      session.interactions(),
      session.status(),
    ]);
    const failure = resolve_failure_text(messages.items);
    return {
      mode: "detail",
      session: {
        session_id: item.session_id,
        agent_id: this.options.agent_id,
        ...(item.workspace_id ? { workspace_id: item.workspace_id } : {}),
        ...(item.title ? { title: item.title } : {}),
        state: resolve_session_state({
          executing: status.state === "running",
          pending_interaction_count: pending.length,
        }),
        ...(item.preview_text ? { preview_text: item.preview_text } : {}),
        ...(typeof item.updated_at === "number" ? { updated_at: item.updated_at } : {}),
        pending_interaction_count: pending.length,
      },
      messages: messages.items
        .map((message) => project_message_text(message))
        .filter((entry): entry is { role: "user" | "agent"; text: string } => Boolean(entry)),
      pending_interactions: pending.map((interaction) => ({
        interaction_id: interaction.interaction_id,
        type: interaction.type,
        ...(interaction.title ? { title: interaction.title } : {}),
        ...(interaction.description ? { description: interaction.description } : {}),
      })),
      ...(failure ? { failure } : {}),
    };
  }

  /** 直接读取持久化历史分页，compact 只改变模型副本，不改变此原文。 */
  async messages(input: ListSessionMessagesInput & { /** 目标工作会话标识。 */ session_id: string }): Promise<SessionMessagePage> {
    const item = await this.require_list_entry(input.session_id);
    const session = await this.options.get_session(item.session_id, item.origin.type);
    return await session.messages({ limit: input.limit, before_sequence: input.before_sequence });
  }

  /** 仅归档 Work 来源，避免模型移除主对话或外部 Channel 路由。 */
  async archive(input: { /** 待归档的工作会话标识。 */ session_id: string }): Promise<AgentArchiveSessionResult> {
    const item = await this.require_list_entry(input.session_id);
    if (item.origin.type !== "work") throw new Error("session.archive only supports Work Sessions");
    const session = await this.options.get_session(item.session_id, item.origin.type);
    return await session.archive();
  }

  /** 代答某条会话正在等待的用户响应。 */
  async reply(input: {
    session_id: string;
    interaction_id: string;
    response: SessionInteractionResponse;
  }): Promise<void> {
    const item = await this.require_list_entry(input.session_id);
    const session = await this.options.get_session(item.session_id, item.origin.type);
    const pending = await session.interactions();
    if (!pending.some((entry) => entry.interaction_id === input.interaction_id)) {
      throw new Error(
        `Interaction is not pending on session "${input.session_id}": ${input.interaction_id}`,
      );
    }
    await session.respond({
      interaction_id: input.interaction_id,
      response: input.response,
    });
  }

  /** 停止某条会话当前正在执行的 Turn。 */
  async stop(input: { session_id: string }): Promise<void> {
    const item = await this.require_list_entry(input.session_id);
    const session = await this.options.get_session(item.session_id, item.origin.type);
    await this.options.delegations.cancel(item.session_id);
    await session.stop();
  }

  /** 按标识取出属于当前 Agent 的一条会话；不存在时明确失败。 */
  private async require_list_entry(session_id_input: string): Promise<SessionWorkListEntry> {
    const session_id = String(session_id_input || "").trim();
    if (!session_id) throw new Error("Session id is required");
    const page = await this.options.list_sessions({ limit: Number.MAX_SAFE_INTEGER });
    const item = page.items.find((candidate) => candidate.session_id === session_id);
    if (!item) throw new Error(`Session is not owned by this agent: ${session_id}`);
    return item;
  }

  /** 读取一条会话当前待响应的 Interaction 数量；读取失败时按零处理。 */
  private async count_pending(item: SessionWorkListEntry): Promise<number> {
    try {
      const session = await this.options.get_session(item.session_id, item.origin.type);
      return (await session.interactions()).length;
    } catch {
      return 0;
    }
  }
}

/** 归一化可选数量上限；非法值回退到默认值。 */
function normalize_limit(input: number | undefined, fallback: number): number {
  return Number.isInteger(input) && (input as number) > 0 ? (input as number) : fallback;
}

/** 由执行态与待响应数量推导清单状态。 */
function resolve_session_state(input: {
  /** 该会话当前是否在执行 Turn。 */
  executing: boolean;
  /** 当前待用户响应的 Interaction 数量。 */
  pending_interaction_count: number;
}): SessionToolState {
  if (input.pending_interaction_count > 0) return "waiting_for_user";
  if (input.executing) return "running";
  return "idle";
}

/** 把 canonical Message 投影为纯文本；没有可见文本时返回空。 */
function project_message_text(message: {
  role: string;
  parts: readonly { type: string; text?: string }[];
}): { role: "user" | "agent"; text: string } | null {
  if (message.role !== "user" && message.role !== "agent") return null;
  const text = message.parts
    .flatMap((part) => (typeof part.text === "string" ? [part.text] : []))
    .join("\n")
    .trim();
  return text ? { role: message.role, text } : null;
}

/** 读取最近一条 Agent 消息上的失败文本；没有失败时返回空。 */
function resolve_failure_text(
  messages: readonly {
    role: string;
    parts: readonly { type: string; message?: string }[];
  }[],
): string | undefined {
  const latest_agent = [...messages].reverse().find((message) => message.role === "agent");
  const error = latest_agent?.parts.find((part) => part.type === "error");
  return error?.message ? error.message : undefined;
}
