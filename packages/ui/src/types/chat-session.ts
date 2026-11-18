/** Chat UI 连接现有 Session actor 的最小能力，不拥有 Agent、网络 transport 或服务端资源。 */
import type { ListSessionMessagesInput, RespondSessionInteractionInput, SessionMessagePage, SessionMessageCheckpoint, SessionModelRetryInput, SessionModelRetryResult, SessionMutation, SessionRuntimeSnapshot } from "@downcity/type";
import type { ChatComposerPart } from "./chat-document";
import type { DowncityChatRuntime } from "../lib/chat-runtime";
/** 本地 Session 或 @downcity/city/browser RemoteSession 均可直接满足此契约。 */
export interface DowncityChatSession {
  /** 由宿主持有的稳定会话身份。 */ readonly id: string;
  /** 等待事件通道 ready 后返回解除订阅函数；断流必须通知 on_close。 */
  watch(listener: (mutation: SessionMutation) => void, on_close: (error: Error) => void): Promise<() => void>;
  /** 读取 canonical 历史页面。 */ messages(input?: ListSessionMessagesInput): Promise<SessionMessagePage>;
  /** 读取运行态与当前可重试锚点。 */ status(): Promise<SessionRuntimeSnapshot>;
  /** 提交本次新增内容，运行中即时追加由 Session 决定归属。 */ prompt(input: { /** 原位有序内容。 */ query: string | ChatComposerPart[] }): Promise<unknown>;
  /** 按点击时观测的 Turn 和消息版本停止，避免旧按钮控制同 Turn 的后续调用。 */
  stop(expected_turn_id?: string, expected_message?: SessionMessageCheckpoint): Promise<unknown>;
  /** 以既有协议响应审批或提问。 */ respond(input: RespondSessionInteractionInput): Promise<unknown>;
  /** 重试当前进程内仍有效的失败步骤。 */ retry_model_step(input: SessionModelRetryInput): Promise<SessionModelRetryResult>;
}
/** 一次 UI 订阅连接；关闭仅释放订阅，不销毁 Session 或 RemoteAgent。 */
export interface DowncityChatConnection {
  /** 直接交给 ChatPanel 的状态容器。 */ runtime: DowncityChatRuntime;
  /** 幂等释放本连接的事件与待发布任务；调用方另行关闭自己创建的客户端。 */ close(): void;
  /** 分页读取更早历史，返回是否仍有更早内容。 */ load_earlier(): Promise<boolean>;
}
