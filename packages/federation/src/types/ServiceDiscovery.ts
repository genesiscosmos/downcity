/**
 * Federation 服务发现公开契约。
 *
 * 文档随注册定义保存；就绪检查只检查本地配置和依赖，不执行业务请求。
 * reason 必须是作者明确允许公开的固定说明，不能包含密钥、连接串或异常文本。
 */

/** 本地系统就绪状态，不代表调用方权限、余额或上游在线承诺。 */
export interface ServiceAvailability {
  /** ready 为本地条件满足；partial 为部分入口就绪；unknown 为没有充分证据。 */
  status: "ready" | "partial" | "unavailable" | "unknown";
  /** 可安全公开的本地状态原因。 */
  reason?: string;
}

/** 无副作用的本地依赖检查；禁止调用付费业务和返回原始异常。 */
export type ServiceAvailabilityCheck = () => ServiceAvailability | Promise<ServiceAvailability>;

/** OpenAPI 3.1 / JSON Schema 文档，不改变 action 的运行时校验。 */
export type ApiSchema = Record<string, unknown>;

/** 一个请求或响应示例。 */
export interface ApiExample {
  /** 示例的简短名称。 */
  name: string;
  /** 请求输入（GET 为 query 对象，raw 协议可为字符串）。 */
  request?: unknown;
  /** 响应示例；流式协议可使用代表性的事件文本。 */
  response?: unknown;
}

/** API 可能返回的业务或协议错误。 */
export interface ApiError {
  /** HTTP 错误状态码。 */
  status: number;
  /** 可公开的错误条件说明。 */
  description: string;
}

/** Action 和原生 route 共用的注册文档。 */
export interface ApiDocumentation {
  /** 入口用途、行为边界与调用要求。 */
  description: string;
  /** 请求 schema；不适用或尚未描述时应省略，禁止以空对象冒充完整契约。 */
  request_schema?: ApiSchema;
  /** 成功响应 schema；流式、二进制等协议可结合 content type 描述。 */
  response_schema?: ApiSchema;
  /** 成功 HTTP 状态，默认 200。 */
  response_status?: number;
  /** 请求正文媒体类型，默认 JSON；GET 无正文。 */
  request_content_type?: string;
  /** 成功响应媒体类型，默认 JSON。 */
  response_content_type?: string;
  /** 同一成功状态下按媒体类型分别声明的响应 schema，优先于单一响应字段。 */
  response_content?: Record<string, ApiSchema>;
  /** 特殊协议名称，例如 sse、oauth、webhook、binary。 */
  protocol?: string;
  /** 明确的错误条件。 */
  errors?: ApiError[];
  /** 使用公开占位值的请求与响应示例。 */
  examples?: ApiExample[];
  /** 可安全公开的配置和依赖要求，不包含实际值。 */
  requirements?: string[];
  /** 只检查本地条件的入口就绪检查。 */
  availability?: ServiceAvailabilityCheck;
  /** HTTP 别名的文档覆盖，键为公开绝对路径，仅影响已注册别名的投影。 */
  aliases?: Record<string, Omit<ApiDocumentation, "availability" | "aliases">>;
}

/** Service 构造时声明的公开说明和本地就绪检查。 */
export interface ServiceDiscoveryOptions {
  /** 服务用途摘要。 */
  description?: string;
  /** 可公开的配置与依赖要求，不包含密钥实际值。 */
  requirements?: string[];
  /** 未提供时，不能仅凭注册就认定就绪。 */
  availability?: ServiceAvailabilityCheck;
}
