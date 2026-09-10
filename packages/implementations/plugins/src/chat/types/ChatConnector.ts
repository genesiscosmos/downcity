/** Chat 平台 Connector 与 Chat Runtime 之间的最小协议。 */

import type { PluginJsonValue, PluginLogger } from "@downcity/city/plugin";
import type {
  IncomingChatAccessParams,
  IncomingChatAccessResult,
  IncomingChatMessage,
} from "@/chat/channels/BaseChatChannel.js";
import type { ChatChannelTestResult } from "./ChannelStatus.js";

/** Connector 可以附加到审计事件的跨平台 JSON 元数据。 */
export interface ChannelUserMessageMeta {
  /** 平台字段保持原始名称和值，但不能包含不可序列化对象。 */
  [key: string]: PluginJsonValue | undefined;
}

/** Chat Runtime 注入单个 Account Connector 的稳定运行依赖。 */
export interface ChatConnectorContext {
  /** 当前 Bot Account 稳定 ID。 */
  account_id: string;
  /** 当前 Bot 默认路由的 Agent ID。 */
  agent_id: string;
  /** 附件保存与 Agent 执行使用的 Workspace 根目录。 */
  workspace_path: string;
  /** 当前 Bot Account 的私有运行数据目录。 */
  storage_path: string;
  /** Chat Plugin 生命周期日志器。 */
  logger: PluginLogger;
  /** 执行外部身份准入判断。 */
  evaluate_access(input: IncomingChatAccessParams): Promise<IncomingChatAccessResult>;
  /** 持久化并调度一条标准化入站消息。 */
  receive_message(input: IncomingChatMessage): Promise<{ chat_key: string; position: number }>;
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

/** Chat Runtime 持有的一个平台 Connector。 */
export interface ChatConnector {
  /** 启动平台连接。 */
  start(): Promise<void>;
  /** 停止平台连接并释放资源。 */
  stop(): Promise<void>;
  /** 测试当前平台凭据和网络连通性。 */
  testConnection(): Promise<ChatChannelTestResult>;
  /** 读取当前连接状态快照。 */
  getExecutorStatus(): {
    /** Connector 是否正在运行。 */
    running: boolean;
    /** 平台连接状态。 */
    linkState: "connected" | "disconnected" | "unknown";
    /** 平台实现提供的稳定状态文本。 */
    statusText: string;
    /** 非敏感诊断详情。 */
    detail: Record<string, string | number | boolean | null>;
  };
}
