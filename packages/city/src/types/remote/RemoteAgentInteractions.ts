/**
 * Agent 交互集合的远程传输能力。
 *
 * Agent 身份由连接绑定，线协议仅携带原 Session/Turn/Interaction 引用。
 * 私密提交与普通响应使用不同协议方法，不经过 Power action 或 Session prompt。
 */
import type {
  AgentInteraction,
  AgentInteractionChange,
  AgentListInteractionsInput,
  AgentRespondInteractionInput,
  SessionInteractionResult,
} from "@downcity/agent";
import type { TransportSubscription } from "@/remote/RemoteTransport.js";

/** Agent 集合事件连接的回调。 */
export interface RemoteInteractionSubscriptionInput {
  /** 已提交的 canonical Interaction 变化。 */
  on_event: (change: AgentInteractionChange) => void;
  /** 底层连接意外结束；主动取消订阅不触发。 */
  on_close: (error?: unknown) => void;
}

/** HTTP/RPC 共用的 Agent 绑定交互传输接口。 */
export interface RemoteAgentInteractionTransport {
  /** 读取当前 Agent 的待处理交互，不恢复 Session。 */
  list_interactions(input?: AgentListInteractionsInput): Promise<AgentInteraction[]>;
  /** 建立未来变化订阅；Promise 兑现代表服务端已注册监听。 */
  subscribe_interactions(input: RemoteInteractionSubscriptionInput): Promise<TransportSubscription>;
  /** 提交普通交互响应。 */
  respond_interaction(input: AgentRespondInteractionInput): Promise<SessionInteractionResult>;
  /** 向受信原 Session 的专用私密入口提交，禁止普通日志记录明文。 */
  submit_private_interaction(input: AgentRespondInteractionInput): Promise<SessionInteractionResult>;
}
