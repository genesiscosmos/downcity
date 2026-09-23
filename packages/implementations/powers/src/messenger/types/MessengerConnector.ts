/** Messenger 平台 Connector 与 Messenger Runtime 之间的最小协议。 */

import type { PowerJsonValue, PowerLogger } from "@downcity/city/power";
import type {
  IncomingMessengerAccessParams,
  IncomingMessengerAccessResult,
  IncomingMessengerMessage,
} from "@/messenger/channels/BaseMessengerChannel.js";
import type { MessengerChannelTestResult } from "./ChannelStatus.js";

/** Connector 可以附加到审计事件的跨平台 JSON 元数据。 */
export interface ChannelUserMessageMeta {
  /** 平台字段保持原始名称和值，但不能包含不可序列化对象。 */
  [key: string]: PowerJsonValue | undefined;
}

/** Messenger Runtime 注入单个 Account Connector 的稳定运行依赖。 */
export interface MessengerConnectorContext {
  /** 当前 Bot Account 稳定 ID。 */
  account_id: string;
  /** 当前 Bot 默认路由的 Agent ID。 */
  agent_id: string;
  /** 附件保存与 Agent 执行使用的 Workspace 根目录。 */
  workspace_path: string;
  /** 当前 Bot Account 的私有运行数据目录。 */
  storage_path: string;
  /** Messenger Power 生命周期日志器。 */
  logger: PowerLogger;
  /** 执行外部身份准入判断。 */
  evaluate_access(input: IncomingMessengerAccessParams): Promise<IncomingMessengerAccessResult>;
  /** 持久化并调度一条标准化入站消息。 */
  receive_message(input: IncomingMessengerMessage): Promise<{ chat_key: string; position: number }>;
  /** 记录一条只用于诊断、不触发 Agent 的入站事件。 */
  record_audit(input: {
    /** 平台会话 ID。 */
    chat_id: string;
    /** 平台消息 ID。 */
    message_id?: string;
    /** 外部用户 ID。 */
    user_id?: string;
    /** 可诊断文本。 */
    text: string;
    /** 可选平台元数据。 */
    meta?: ChannelUserMessageMeta;
  }): Promise<void>;
  /** 删除或重置指定外部会话当前映射。 */
  clear_conversation(input: {
    /** 平台会话 ID。 */
    chat_id: string;
    /** 平台会话类型。 */
    chat_type?: string;
    /** 可选 Thread/Topic ID。 */
    thread_id?: string;
  }): Promise<void>;
}

/** Messenger Runtime 持有的一个平台 Connector。 */
export interface MessengerConnector {
  /** 启动平台连接。 */
  start(): Promise<void>;
  /** 停止平台连接并释放资源。 */
  stop(): Promise<void>;
  /** 测试当前平台凭据和网络连通性。 */
  testConnection(): Promise<MessengerChannelTestResult>;
  /** 读取当前连接状态快照。 */
  getExecutorStatus(): MessengerConnectorStatus;
}

/**
 * Connector 向 Messenger Runtime 报告的连接状态快照。
 *
 * 关键点（中文）
 * - `linkState` 是唯一权威的链路语义，Runtime 不再根据 statusText 猜测。
 * - `link_error` 必须是可直接展示的原因，供 Desktop 与 Activity 直接使用。
 */
export interface MessengerConnectorStatus {
  /** Connector 在进程内是否处于运行态。 */
  running: boolean;
  /**
   * 与平台的实际链路状态。
   *
   * 说明（中文）
   * - `connected`：已完成平台握手，可收发消息。
   * - `connecting`：已启动但尚未确认可用（例如等待长连接 READY）。
   * - `error`：启动或链路已明确失败，必须展示失败原因。
   * - `disconnected`：未启动或已停止。
   */
  linkState: "connected" | "connecting" | "error" | "disconnected";
  /** 平台实现提供的稳定状态文本。 */
  statusText: string;
  /** 最近一次连接失败的用户可读原因；仅在 linkState 为 error 时提供。 */
  link_error?: string;
  /** 非敏感诊断详情。 */
  detail: Record<string, string | number | boolean | null>;
}
