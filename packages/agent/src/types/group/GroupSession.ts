/** GroupSession 的公开领域类型：一次 Group 的独立群聊上下文。 */

import type { AgentSession } from "@/types/agent/SessionActor.js";
import type {
  GroupMember,
  GroupMessage,
} from "@/types/group/Group.js";
import type { WorkspaceBase } from "@downcity/workspace";

/** Group 消息订阅回调。 */
export type GroupMessageSubscriber = (message: GroupMessage) => void | Promise<void>;

/** 取消 Group 消息订阅。 */
export type GroupMessageUnsubscribe = () => void;

/** 向 GroupSession 发言的输入。 */
export interface GroupPromptInput {
  /** 用户消息正文。 */
  readonly query: string;
}

/** 成员当前是否正在处理 Group 消息。 */
export interface GroupMemberRuntime {
  /** 成员 Agent 标识。 */
  readonly agent_id: string;
  /** 当前是否正在处理消息。 */
  readonly running: boolean;
}

/** GroupSession 列表使用的轻量摘要，不加载消息历史。 */
export interface GroupSessionSummary {
  /** GroupSession 稳定标识。 */
  readonly id: string;
  /** 所属 Group 稳定标识。 */
  readonly group_id: string;
  /** 首次创建时间戳。 */
  readonly created_at: number;
  /** 最近更新时间戳。 */
  readonly updated_at: number;
  /** 已持久化消息数量。 */
  readonly message_count: number;
  /** 当前 GroupSession 绑定的 Workspace 标识。 */
  readonly workspace_id?: string;
  /** 最后一条消息的用户可见预览。 */
  readonly preview_text?: string;
}

/** GroupSession 的创建输入；第一阶段不允许调用方指定 session_id。 */
export interface GroupSessionCreateInput {
  /** 当前群聊使用的 Workspace；省略时使用内存执行上下文。 */
  readonly workspace?: WorkspaceBase;
}

/** 恢复 GroupSession 时的上下文输入。 */
export interface GroupSessionGetInput {
  /** 当前群聊使用的 Workspace；必须与持久化 metadata 一致。 */
  readonly workspace?: WorkspaceBase;
}

/** GroupSession 列表过滤条件。 */
export interface GroupSessionListInput {
  /** 只返回绑定到指定 Workspace 的群聊上下文。 */
  readonly workspace_id?: string;
}

/** GroupSession 公开能力。 */
export interface GroupSessionContract {
  /** 当前群聊上下文的稳定标识。 */
  readonly id: string;
  /** 所属 Group 的稳定标识。 */
  readonly group_id: string;
  /** 当前 GroupSession 绑定的 Workspace ID；未绑定时为空。 */
  readonly workspace_id?: string;
  /** 追加用户消息并等待当前群聊传播完成。 */
  prompt(input: GroupPromptInput): Promise<void>;
  /** 读取共享消息事实快照。 */
  messages(): Promise<readonly GroupMessage[]>;
  /** 订阅共享消息。 */
  subscribe(subscriber: GroupMessageSubscriber): GroupMessageUnsubscribe;
  /** 读取每个成员当前是否正在执行的运行态快照。 */
  member_statuses(): readonly GroupMemberRuntime[];
  /** 停止当前传播和成员执行；停止完成后可再次 prompt。 */
  stop(): Promise<void>;
  /** 释放当前上下文，不再接受新的 prompt。 */
  dispose(): Promise<void>;
}

/** GroupSession 的公开实例类型。 */
export interface GroupSession extends GroupSessionContract {}

/** GroupSession 集合公开能力。 */
export interface GroupSessions {
  /** 创建一个新的群聊上下文，标识由集合内部生成。 */
  create(input?: GroupSessionCreateInput): Promise<GroupSession>;
  /** 从 Storage 恢复当前 Group 的一个群聊上下文。 */
  get(session_id: string, input?: GroupSessionGetInput): Promise<GroupSession | null>;
  /** 从 Storage 恢复当前 Group 的全部群聊上下文。 */
  list(input?: GroupSessionListInput): Promise<readonly GroupSessionSummary[]>;
  /** 释放并移除指定群聊上下文。 */
  remove(session_id: string, input?: GroupSessionGetInput): Promise<GroupSession | null>;
}

/** GroupSession 的内部依赖快照。 */
export interface GroupSessionRuntimeContext {
  /** 当前 Group 的成员。 */
  readonly members: readonly GroupMember[];
  /** 当前 Group 的协作说明。 */
  readonly instruction?: string;
  /** 当前 Group 的注意力策略。 */
  readonly attention_policy: import("@/types/group/AttentionPolicy.js").AttentionPolicy;
  /** 当前 Group 的稳定标识。 */
  readonly group_id: string;
  /** 当前 Group 的展示名称。 */
  readonly group_name: string;
}

/** 当前群聊上下文中由 Agent 持有的成员 Session。 */
export type GroupMemberSession = AgentSession;
