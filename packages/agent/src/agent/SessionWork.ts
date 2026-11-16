/**
 * SessionWork：Agent 会话安排与观察其他会话的实现。
 *
 * 职责说明（中文）
 * - 把 AgentSessions 的能力投影成「一件活」的完整动作：开、看、答、停。
 * - 只读取公开的摘要与消息投影，不缓存会话，也不持有存储。
 *
 * 关键点（中文）
 * - 清单包含当前 Agent 的全部分类；详情和历史直接读取存储，不恢复执行器。
 * - `spawn` 不等待 Turn 结束：派活的意义就是 Agent 会话立刻能继续。
 * - 详情按最近消息分页读取，让对话能回答「它做了什么」，而不把整段历史塞进上下文。
 */

import type { ListSessionMessagesInput, SessionMessagePage } from "@downcity/type";
import type { AgentArchiveSessionResult } from "@/types/agent/SessionTypes.js";
import type { SessionInteractionResponse } from "@downcity/type";
import type { SessionDelegationCaller, SessionDelegationInput, SessionDelegationMessage, SessionDelegationPort, SessionDelegationReceipt } from "@/types/agent/SessionDelegation.js";
import { SESSION_ORIGIN_CATEGORY_WORK } from "@downcity/type";
import type { SessionStore } from "@/types/store/SessionStore.js";
import { require_direct_work_child } from "./SessionWorkPolicy.js";
import { project_session_interaction } from "@/session/messages/SessionInteractionProjection.js";
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
  origin: { category: string; type: string };
  /** 当前是否正在执行。 */
  executing?: boolean;
  /** 是否来自归档区，只可读取。 */
  archived?: boolean;
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
  get_session: (session_id: string, category: string) => Promise<AgentSession>;
  /** 只查看集合持有的运行状态，不恢复目标执行器。 */
  is_executing: (session_id: string, category: string) => boolean;
  /** 只读持久化会话入口，不恢复执行器。 */
  read_session: SessionStore["read_session"];
  /** 精确只读归档记录；UUID不授予执行控制权。 */
  read_archived_session: SessionStore["read_archived_session"];
  /** 读取原计划供直接父子控制权限核验，不以新活动记录替代。 */
  read_archive_plan: SessionStore["read_archive_plan"];
  /** 唯一集合归档入口，执行持久化计划。 */
  archive_session: (input: import("@/types/agent/SessionTypes.js").AgentArchiveSessionInput) => Promise<AgentArchiveSessionResult>;
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
    await this.require_control_target(input.session_id, caller);
    return await this.options.delegations.send(input, caller);
  }

  /** 列出当前 Agent 的全部活动会话，不按委派角色过滤。 */
  async list(input?: { limit?: number }): Promise<SessionToolSummary[]> {
    const page = await this.options.list_sessions({
      limit: normalize_limit(input?.limit, DEFAULT_SESSION_LIMIT),
    });
    const summaries: SessionToolSummary[] = [];
    for (const item of page.items) {

      const pending_interaction_count = await this.count_pending(item);
      summaries.push({
        session_id: item.session_id,
        session_category: item.origin.category as "chat" | "work",
        archived: item.archived === true,
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
  async read(input: Parameters<SessionWorkContract["read"]>[0]): Promise<SessionCheckDetailToolOutput> {
    const snapshot = await this.read_target(input);
    const item = snapshot.metadata;
    const [messages, pending] = await Promise.all([
      snapshot.messages({ limit: normalize_limit(input.limit, DEFAULT_MESSAGE_LIMIT) }),
      snapshot.interactions(),
    ]);
    const executing = !snapshot.archived && this.options.is_executing(input.session_id, input.session_category);
    const failure = resolve_failure_text(messages.items);
    return {
      mode: "detail",
      session: {
        session_id: input.session_id,
        session_category: input.session_category,
        archived: snapshot.archived,
        agent_id: this.options.agent_id,
        ...(item.workspace_id ? { workspace_id: item.workspace_id } : {}),
        ...(item.title ? { title: item.title } : {}),
        state: resolve_session_state({
          executing,
          pending_interaction_count: pending.length,
        }),
        ...(item.preview_text ? { preview_text: item.preview_text } : {}),
        ...(typeof item.updated_at === "number" ? { updated_at: item.updated_at } : {}),
        pending_interaction_count: pending.length,
      },
      messages: messages.items
        .map((message) => project_message_text(message))
        .filter((entry): entry is { role: "user" | "agent"; text: string } => Boolean(entry)),
      pending_interactions: pending.map(project_session_interaction),
      ...(failure ? { failure } : {}),
    };
  }

  /** 直接读取持久化历史分页，compact 只改变模型副本，不改变此原文。 */
  async messages(input: Parameters<SessionWorkContract["messages"]>[0]): Promise<SessionMessagePage> {
    const snapshot = await this.read_target(input);
    return await snapshot.messages({ limit: normalize_limit(input.limit, DEFAULT_MESSAGE_LIMIT), before_sequence: input.before_sequence });
  }

  /** 仅归档工作分类的会话，避免模型移除主对话或外部聊天路由。 */
  async archive(input: Parameters<SessionWorkContract["archive"]>[0], caller: SessionDelegationCaller): Promise<AgentArchiveSessionResult> {
    const plan = input.operation_id ? await this.options.read_archive_plan(input.operation_id) : null;
    if (plan) {
      if (plan.root_session_id !== input.session_id || plan.category !== "work" || (input.root_session_id && plan.root_session_id !== input.root_session_id)) throw new Error("session_archive_operation_conflict");
      const root = plan.nodes.at(-1)!;
      const view = root.committed_at !== null ? await this.options.read_archived_session(root.session_id)
        : await this.options.read_session(root.session_id, root.category);
      if (view.session_id !== root.session_id) throw new Error("session_archive_record_changed");
      require_direct_work_child(this.options.agent_id, caller, { id: input.session_id, agent_id: view.metadata.agent_id, origin: view.metadata.origin });
    } else {
      await this.require_control_target(input.session_id, caller);
      await this.require_idle_subtree(input.session_id);
    }
    return await this.options.archive_session({ id: input.session_id, category: "work", operation_id: input.operation_id, root_session_id: input.root_session_id });
  }

  /** 代答某条会话正在等待的用户响应。 */
  async reply(input: {
    session_id: string;
    interaction_id: string;
    response: SessionInteractionResponse;
  }, caller: SessionDelegationCaller): Promise<void> {
    const item = await this.require_control_target(input.session_id, caller);
    const session = await this.options.get_session(item.session_id, item.origin.category);
    const pending = await session.interactions();
    if (!pending.some((entry) => entry.interaction_id === input.interaction_id)) {
      throw new Error(
        `Interaction is not pending on session "${input.session_id}": ${input.interaction_id}`,
      );
    }
    if (pending.find((entry) => entry.interaction_id === input.interaction_id)?.type !== "question") {
      throw new Error("session.reply cannot approve operations; use the user's approval interface");
    }
    await session.respond({
      interaction_id: input.interaction_id,
      response: input.response,
    });
  }

  /** 停止某条会话当前正在执行的 Turn。 */
  async stop(input: { /** 目标普通 Work 标识。 */ session_id: string }, caller: SessionDelegationCaller): Promise<void> {
    await this.require_control_target(input.session_id, caller);
    await this.stop_subtree(input.session_id, new Set(), false);
  }

  /** 控制权限在服务层检查，非 Power 调用也不能跳过父子约束。 */
  private async require_control_target(session_id: string, caller: SessionDelegationCaller): Promise<SessionWorkListEntry> {
    const snapshot = await this.options.read_session(session_id, "work");
    if (snapshot.archived) throw new Error("session_archived: cannot control an archived Session");
    require_direct_work_child(this.options.agent_id, caller, {
      id: session_id, agent_id: snapshot.metadata.agent_id, origin: snapshot.metadata.origin,
    });
    return { ...snapshot.metadata, session_id, origin: snapshot.metadata.origin };
  }

  /** 先终止父执行，再扫描子关系，覆盖停止前已提交的子创建。 */
  private async stop_subtree(session_id: string, visited: Set<string>, suppress_delivery = true): Promise<void> {
    if (visited.has(session_id)) return;
    visited.add(session_id);
    await this.options.delegations.cancel(session_id, suppress_delivery);
    const session = await this.options.get_session(session_id, "work");
    await session.stop();
    for (const child_id of await this.options.delegations.children(session_id, "work")) {
      const snapshot = await this.options.read_session(child_id, "work");
      if (!snapshot.archived) await this.stop_subtree(child_id, visited);
    }
  }

  /** 归档前验证整个子树空闲，保留关系而不递归删除历史。 */
  private async require_idle_subtree(session_id: string, visited = new Set<string>()): Promise<void> {
    if (visited.has(session_id)) throw new Error("session_relation_invalid: cyclic Work tree");
    visited.add(session_id);
    const snapshot = await this.options.read_session(session_id, "work");
    if (snapshot.archived) return;
    const session = await this.options.get_session(session_id, "work");
    if ((await session.status()).state === "running" || (await snapshot.interactions()).length) {
      throw new Error("session_subtree_busy: finish or stop child work before archiving");
    }
    for (const child_id of await this.options.delegations.children(session_id, "work")) {
      await this.require_idle_subtree(child_id, visited);
    }
  }

  /** UUID只定位当前Agent拥有的归档；逻辑ID/分类必须与记录匹配。 */
  private async read_target(input: Parameters<SessionWorkContract["read"]>[0]) {
    const view = input.archived
      ? await this.options.read_archived_session(input.session_id)
      : await this.options.read_session(input.session_id, input.session_category);
    if (view.metadata.agent_id !== this.options.agent_id || view.metadata.session_id !== input.session_id
      || view.metadata.origin.category !== input.session_category) throw new Error("session_address_conflict");
    return view;
  }

  /** 按记录状态读取真实pending，存储失败不能伪装成零。 */
  private async count_pending(item: SessionWorkListEntry): Promise<number> {
    const snapshot = item.archived
      ? await this.options.read_archived_session(item.session_id)
      : await this.options.read_session(item.session_id, item.origin.category);
    return (await snapshot.interactions()).length;
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
