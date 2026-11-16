/** MCP 脱敏失败协议；只携带本地分类、数字状态码与白名单原因。 */
export interface McpFailureDetail {
  /** 用户应采取何种恢复操作；取消与超时分别表示。 */
  kind: "connection" | "authorization" | "timeout" | "protocol" | "cancelled";
  /** 失败发生在资源 HTTP、OAuth 流程还是连接初始化阶段。 */
  phase: "http" | "oauth" | "connection";
  /** 远端 HTTP 状态码；不包含响应体、地址或状态文本。 */
  http_status?: number;
  /** 本地已知的网络、OAuth 或配置原因代码，不接受任意远端文本。 */
  reason_code?: string;
  /** SDK 识别的 JSON-RPC 数字错误码，不包含远端 message/data。 */
  protocol_code?: number;
}
