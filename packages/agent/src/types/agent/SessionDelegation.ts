/**
 * Session 委派协议：将一次工作与发起会话关联，独立记录执行和结果投递状态。
 * 运行时只依赖存储与 Session 端口，不依赖 Agent、City 或 Desktop。
 */
import type { SessionOrigin, WorkspaceRuntime } from "@downcity/type";
import type { AgentSession } from "./SessionActor.js";
import type { AgentSessionTurnResult } from "../sdk/AgentSessionTurn.js";

/** 工具运行时提供的发起身份；不允许模型自行指定回传目标。 */
export interface SessionDelegationCaller {
  /** 发起工作的 Agent 标识；用于将结果回传给真实调用方。 */
  agent_id: string;
  /** 发起工作的 Session 稳定标识。 */
  session_id: string;
  /** 发起会话的持久化来源分区。 */
  origin: SessionOrigin;
  /** 发起调用所属 Turn；用于审计和幂等身份。 */
  turn_id: string;
  /** 发起调用的模型工具标识；同一调用重试复用原委派。 */
  tool_call_id: string;
}

/** 一次完整委派的持久化快照。 */
export interface SessionDelegationRecord {
  /** 本次委派稳定标识，派发与回传都由它去重。 */
  delegation_id: string;
  /** 由运行时绑定的发起者身份。 */
  caller: SessionDelegationCaller;
  /** 预先分配的子会话标识，创建中断后仍复用同一会话。 */
  work_session_id: string;
  /** true 表示显式 session.send 补充已有工作，允许进入当前轮次。 */
  followup: boolean;
  /** 子会话的项目 Workspace 标识，恢复时交由宿主解析。 */
  workspace_id: string;
  /** 子会话唯一收到的完整执行指令。 */
  query: string;
  /** 子会话的用户可见标题。 */
  title?: string;
  /** 子执行的实际 Turn 标识，提交成功后写入。 */
  work_turn_id?: string;
  /** 工作执行状态；停止在调用 stop 前持久化。 */
  execution_state: "pending" | "running" | "succeeded" | "failed" | "stopped";
  /** 回传状态；取消的委派不会自动唤醒父会话。 */
  delivery_state: "pending" | "delivered" | "cancelled";
  /** 连续失败次数；成功回传后不再重试。 */
  attempt_count: number;
  /** 下一次可重试的绝对时间戳，单位毫秒。 */
  retry_at: number;
  /** 最近一次执行或回传故障的说明。 */
  error?: string;
  /** 子执行结束后的权威结果快照。 */
  result?: AgentSessionTurnResult;
}

/** 委派存储边界，事务实现由具体存储提供。 */
export interface SessionDelegationStore {
  /** 按稳定标识读取委派，不存在时返回空。 */
  get(delegation_id: string): Promise<SessionDelegationRecord | undefined>;
  /** 原子创建；同一标识已存在时返回原记录。 */
  create(record: SessionDelegationRecord): Promise<SessionDelegationRecord>;
  /** 在独占锁内根据最新快照更新单条记录。 */
  update(delegation_id: string, mutate: (record: SessionDelegationRecord) => SessionDelegationRecord): Promise<SessionDelegationRecord>;
  /** 读取尚未投递且尚未取消的委派，供显式恢复或重试。 */
  pending(): Promise<SessionDelegationRecord[]>;
}

/** 委派运行时依赖；所有宿主资源都在执行前通过端口解析。 */
export interface SessionDelegationOptions {
  /** 拥有工作会话和委派记录的 Agent 标识。 */
  agent_id: string;
  /** 当前 Agent 的委派存储。 */
  store: SessionDelegationStore;
  /** 按记录中的项目标识解析工作目录。 */
  resolve_workspace: (workspace_id: string) => Promise<WorkspaceRuntime>;
  /** 按预分配标识创建或恢复同一个子会话。 */
  ensure_work_session: (session_id: string, workspace: WorkspaceRuntime) => Promise<AgentSession>;
  /** 恢复已有工作会话；只允许继续 Work 来源的会话。 */
  get_work_session: (session_id: string) => Promise<AgentSession>;
  /** 恢复父会话并完成宿主 Workspace、模型及消息订阅装配。 */
  get_parent_session: (caller: SessionDelegationCaller) => Promise<AgentSession>;
  /** 为恢复的子会话完成宿主模型及消息订阅装配。 */
  prepare_session: (session: AgentSession) => Promise<void>;
  /** 报告后台执行或投递失败；记录保留以便恢复重试。 */
  report_error: (delegation_id: string, error: unknown) => void;
}

/** 工具调用的完整工作输入。 */
export interface SessionDelegationInput {
  /** 新会话收到的独立工作指令。 */
  query: string;
  /** 显式指定的已登记项目 Workspace 标识。 */
  workspace_id: string;
  /** 工作短标题。 */
  title?: string;
}

/** 向已有工作会话追加的完整指令。 */
export interface SessionDelegationMessage {
  /** 接收消息的工作会话标识。 */
  session_id: string;
  /** 新增的要求、材料或反馈。 */
  query: string;
}

/** 派发后立即返回的稳定关联标识。 */
export interface SessionDelegationReceipt {
  /** 已创建的工作会话标识。 */
  session_id: string;
  /** 本次工作的委派标识。 */
  delegation_id: string;
}

/** SessionWork 使用的委派端口。 */
export interface SessionDelegationPort {
  /** 保存委派，准备子会话，然后启动后台执行。 */
  spawn(input: SessionDelegationInput, caller: SessionDelegationCaller): Promise<SessionDelegationReceipt>;
  /** 向已有工作会话追加输入，并沿用持久化结果回传机制。 */
  send(input: SessionDelegationMessage, caller: SessionDelegationCaller): Promise<SessionDelegationReceipt>;
  /** 撤销目标子会话未投递的委派，必须先于 Session.stop 调用。 */
  cancel(session_id: string): Promise<void>;
}
