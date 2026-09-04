/**
 * LLM 配置类型定义。
 *
 * CLI/City LLM 宿主配置。
 *
 * 设计目标（中文）
 * - 将“provider 连接信息”与“model 选择/采样参数”解耦。
 * - 支持在平台全局层配置多个 provider 与多个 model。
 * - 避免在每个 model 上重复填写 apiKey/baseUrl。
 */

/**
 * Provider 类型枚举。
 *
 * 说明（中文）
 * - `open-compatible` 表示 OpenAI 兼容（Chat Completions）网关。
 * - `open-responses` 表示 OpenAI Responses 兼容网关。
 * - `moonshot-cn` 表示 Moonshot(Kimi) 中国站 OpenAI 兼容网关。
 * - `moonshot-ai` 表示 Moonshot(Kimi) 国际站 OpenAI 兼容网关。
 * - `kimi-code` 表示 Kimi Code 的 OpenAI 兼容 coding 网关。
 */
export type LlmProviderType =
  | "anthropic"
  | "openai"
  | "deepseek"
  | "gemini"
  | "open-compatible"
  | "open-responses"
  | "moonshot-cn"
  | "moonshot-ai"
  | "kimi-code"
  | "xai"
  | "huggingface"
  | "openrouter";

/**
 * 单个 provider 连接配置。
 */
export interface LlmProviderConfig {
  /**
   * Provider 类型。
   * 决定运行时使用哪个 SDK 分支和默认 baseUrl。
   */
  type: LlmProviderType;
  /**
   * Provider API 基础地址。
   * 可选；留空时按 `type` 使用内置默认地址。
   */
  baseUrl?: string;
  /**
   * Provider API 密钥。
   * 建议由 Console 模型池直接保存，或由宿主在运行时显式注入 env 后再回退读取。
   */
  apiKey?: string;
}

/**
 * 单个模型配置。
 */
export interface LlmModelConfig {
  /**
   * 引用 `llm.providers` 的 key。
   * 运行时会通过该 key 找到 provider 连接信息。
   */
  provider: string;
  /**
   * 上游模型名称。
   * 例如：`claude-sonnet-4-5`、`gpt-4o`、`gemini-2.5-pro`。
   */
  name: string;
  /**
   * 采样温度。
   * 值越高随机性越强。
   */
  temperature?: number;
  /**
   * 最大输出 token 数。
   */
  maxTokens?: number;
  /**
   * nucleus sampling 参数。
   */
  topP?: number;
  /**
   * 频率惩罚参数。
   */
  frequencyPenalty?: number;
  /**
   * 存在惩罚参数。
   */
  presencePenalty?: number;
  /**
   * Anthropic 专用版本字段（可选）。
   */
  anthropicVersion?: string;
}

/**
 * Ship 主配置中的 llm 节点结构。
 */
export interface LlmConfig {
  /**
   * Provider 配置集合。
   * key 由用户自定义（例如：`openai_main`、`google`）。
   */
  providers: Record<string, LlmProviderConfig>;
  /**
   * 模型配置集合。
   * key 由用户自定义（例如：`fast`、`quality`、`coding`）。
   */
  models: Record<string, LlmModelConfig>;
  /**
   * 是否记录发给 LLM 的请求 payload。
   * 默认启用；设为 false 可关闭。
   */
  logMessages?: boolean;
}
