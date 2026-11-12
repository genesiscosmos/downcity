/** Federation 队列消息及宿主 Adapter 契约；资源随注入的 Federation 统一关闭。 */
export interface FederationQueueMessage {
  /** 消息所调用的已注册 Service ID。 */
  service: string;
  /** Service 内的 Action ID，可包含业务路径。 */
  action: string;
  /** 交给 Action 的 JSON 输入；省略时使用空对象。 */
  input?: Record<string, unknown>;
  /** 建议延迟投递时间，单位毫秒。 */
  delay_ms?: number;
}

/** 平台发送能力；本地消费器必须提供 stop 和 dispose。 */
export interface FederationQueueAdapter {
  /** 将消息交给真实队列；停止后应拒绝发送，不能静默丢弃。 */
  send(message: FederationQueueMessage): Promise<void>;
  /** 停止定时器和新消费；不得等待调用方的 Federation.dispose，避免关闭循环。 */
  stop?(): void | Promise<void>;
  /** Federation 排空业务后释放 Adapter 自有资源，并等待已经触发的消费回调。 */
  dispose?(): void | Promise<void>;
}
