/** Node/Electron OAuth 事务独占的本机回调资源契约。 */
export interface LoopbackLoginCallback {
  /** 127.0.0.1 临时端口及随机路径组成的绝对回调地址。 */
  readonly redirect_uri: string;
  /** 产品回调随机 state，独立于 Provider OAuth state。 */
  readonly state: string;
  /** 仅发起进程保管的 RFC 7636 verifier，用于交换授权码。 */
  readonly code_verifier: string;
  /** verifier 的 S256 base64url challenge，随 login/start 提交。 */
  readonly code_challenge: string;
  /** 已严格验证 Host、路径和 state 的授权码，返回前为空。 */
  readonly authorization_code: string | undefined;
  /** 接收失败或超时的错误，不包含登录秘密。 */
  readonly error: Error | undefined;
  /** 幂等释放监听、连接及超时计时器。 */
  close(): void;
}
