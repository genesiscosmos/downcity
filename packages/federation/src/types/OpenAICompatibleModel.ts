/**
 * OpenAI-compatible Provider Adapter 配置类型模块。
 */

/** OpenAI-compatible Provider Adapter 的显式连接配置。 */
export interface OpenAICompatibleModelAdapterOptions {
  /** 上游 API 根地址，例如 `https://api.deepseek.com/v1`。 */
  base_url: string;
  /** 上游鉴权密钥。 */
  api_key: string;
  /** 可选附加 HTTP 请求头；不能覆盖 Authorization。 */
  headers?: Readonly<Record<string, string>>;
  /** 可选 fetch 实现，主要用于边界测试与自定义网络运行时。 */
  fetch?: typeof globalThis.fetch;
}

/** 创建可供 Agent 直接使用的 OpenAI-compatible 模型客户端配置。 */
export interface OpenAICompatibleModelClientOptions extends OpenAICompatibleModelAdapterOptions {
  /** 当前进程内模型客户端的稳定 ID。 */
  id: string;
  /** 上游请求实际使用的模型 ID。 */
  upstream_model: string;
}
