/**
 * 模型中转领域契约。
 * 公开模型决定能力与售价，渠道决定协议和凭据来源，部署决定上游映射，route
 * 决定可调用入口。调用凭据始终独立于 Federation 登录身份。
 */
import type { AIModelDefinition } from "./AI.js";
import type { CityTableApi } from "../store/table-api.js";
import type { ServiceDatabaseContext } from "./database/Database.js";

/** 一个公开语言模型；能力、reasoning 和计费函数来自已注册模板。 */
export interface RelayModel {
  /** 客户端使用的公开模型 ID。 */
  id: string;
  /** SDK 已注册的能力和售价模板 ID，不随渠道故障切换变化。 */
  template_model_id: string;
  /** 是否允许新调用。 */
  enabled: boolean;
}
/** 上游渠道；只保存凭据引用，不保存明文。 */
export interface RelayChannel {
  /** 渠道稳定 ID。 */
  id: string;
  /** registered 复用已有适配器，另一种使用 SDK 标准 OpenAI 适配器。 */
  adapter: "registered" | "openai_chat_completions";
  /** 是否允许新调用。 */
  enabled: boolean;
  /** OpenAI API 根地址，必须为无认证信息的 HTTPS URL。 */
  base_url?: string;
  /** Federation 环境变量中的凭据名称。 */
  credential_env?: string;
  /** 单次上游尝试的总期限毫秒，包含读取流，默认 120000；超时结果按未知处理。 */
  timeout_ms?: number;
}
/** 一个公开模型在某渠道的具体部署。 */
export interface RelayDeployment {
  /** 部署稳定 ID，用于日志和健康冷却。 */
  id: string;
  /** 公开模型 ID。 */
  model_id: string;
  /** 所属渠道 ID。 */
  channel_id: string;
  /** 真实上游模型 ID。 */
  upstream_model: string;
  /** registered 渠道使用的已注册 runtime 模型 ID。 */
  runtime_model_id?: string;
  /** 是否允许新调用。 */
  enabled: boolean;
  /** 优先级；数值较大的层优先。 */
  priority: number;
  /** 同一优先级内的正整数抽样权重。 */
  weight: number;
}
/** 显式可授权路由；第一批只在同一公开模型的部署间切换。 */
export interface RelayRoute {
  /** 客户端使用的 route ID，与模型 ID 不可重复。 */
  id: string;
  /** 绑定公开模型 ID，决定一致的能力和售价。 */
  model_id: string;
  /** 路由允许使用的部署集合。 */
  deployment_ids: string[];
  /** 第一批默认且唯一的策略。 */
  strategy: "priority_weighted";
  /** 包含首次调用的最大尝试数，范围 1 到 3。 */
  max_attempts: number;
  /** 是否允许新调用。 */
  enabled: boolean;
}
/** 可原子替换的完整目录。 */
export interface RelayCatalog {
  /** 公开模型集合。 */
  models: RelayModel[];
  /** 渠道集合。 */
  channels: RelayChannel[];
  /** 部署集合。 */
  deployments: RelayDeployment[];
  /** 显式路由集合。 */
  routes: RelayRoute[];
}
/** 数据库目录快照。 */
export interface RelayCatalogRecord extends Record<string, unknown> {
  /** 单例配置主键，固定为 catalog。 */
  id: string;
  /** 乐观锁版本，每次成功更新递增。 */
  revision: number;
  /** 经校验的目录 JSON，不包含凭据。 */
  catalog_json: string;
}
/** API Key 创建和更新限制。 */
export interface RelayKeyPolicy {
  /** 用户可读名称。 */
  name: string;
  /** 获准的入口 ID；空集合表示不可调用任何模型，星号表示全部入口。 */
  allowed_models: string[];
  /** 已结算 Credits 的消费软上限；null 表示不设上限。 */
  spend_limit: number | null;
  /** 到期 ISO 时间；null 表示不自动到期。 */
  expires_at: string | null;
}
/** 公开 Key 信息，管理 API 永不返回摘要。 */
export interface RelayKeyInfo extends RelayKeyPolicy {
  /** 随机凭据 ID，与密钥材料独立。 */
  key_id: string;
  /** 所属登录用户。 */
  user_id: string;
  /** 可展示的短前缀。 */
  prefix: string;
  /** active 可调用，disabled 暂停，revoked 不可恢复。 */
  status: "active" | "disabled" | "revoked";
  /** 签发时间。 */
  created_at: string;
}
/** API Key 授权成功后的最小推理主体。 */
export type RelayPrincipal = Pick<RelayKeyRecord, "key_id" | "user_id" | "allowed_models" | "spend_limit">;
/** 持久化调用凭据，只有内部授权存储可读取摘要。 */
export interface RelayKeyRecord extends Record<string, unknown>, RelayKeyInfo {
  /** 高熵明文凭据的 SHA-256 摘要。 */
  digest: string;
}
/** 更新凭据的可选策略和状态。 */
export interface RelayKeyUpdate extends Partial<RelayKeyPolicy> {
  /** 要修改的当前用户所属 Key ID。 */
  key_id: string;
  /** 停用可以恢复，撤销不可恢复。 */
  status?: RelayKeyInfo["status"];
}
/** 用户调用日志查询，使用请求 ID 游标分页。 */
export interface RelayLogQuery {
  /** 最多返回的条数，1 到 100。 */
  limit?: number;
  /** 读取此 request_id 之前的记录。 */
  before?: string;
  /** 可选 API Key ID，用户查询仍强制限定自身归属。 */
  key_id?: string;
}
/** 用户可读的调用与结算结果。 */
export interface RelayRequestLog extends RelayRequestRecord {
  /** 可靠结算状态；尚未移交结算时为 null。 */
  settlement_status: string | null;
  /** 技术计量是否可用；尚未记录时为 null。 */
  metering_status: string | null;
  /** 未缓存输入 Token，未知为 null。 */
  uncached_input_tokens: number | null;
  /** 缓存输入 Token，未知为 null。 */
  cached_input_tokens: number | null;
  /** 输出 Token，未知为 null。 */
  output_tokens: number | null;
  /** 推理 Token，未知为 null。 */
  reasoning_tokens: number | null;
  /** 总执行耗时毫秒，未知为 null。 */
  duration_ms: number | null;
  /** 最终计量所属渠道，未知为 null。 */
  channel_id: string | null;
  /** 最终实际模型映射，未知为 null。 */
  upstream_model: string | null;
  /** 仅 completed 结算返回实际 Credits，其他状态为 null。 */
  charged_credits: number | null;
}
/** 新签发 Key，明文仅在此次结果返回。 */
export interface RelayKeyIssued {
  /** 可保存的管理信息。 */
  key: RelayKeyInfo;
  /** 仅此次返回的明文调用凭据。 */
  api_key: string;
}
/** 一个逻辑推理请求的最小日志。 */
export interface RelayRequestRecord extends Record<string, unknown> {
  /** 同时作为既有 AI usage_id 的请求标识。 */
  request_id: string;
  /** 调用者用户 ID。 */
  user_id: string;
  /** API Key ID；登录调用为 null。 */
  key_id: string | null;
  /** 用户请求的公开模型或 route ID。 */
  requested_model: string;
  /** 选中的公开模型 ID。 */
  model_id: string;
  /** running、succeeded、failed、cancelled 或 unknown。 */
  status: string;
  /** 请求开始时间。 */
  started_at: string;
  /** 完成时间，未完成为 null。 */
  completed_at: string | null;
}
/** 每次上游尝试日志，不包含正文和错误响应。 */
export interface RelayAttemptRecord extends Record<string, unknown> {
  /** 独立的上游尝试 ID。 */
  attempt_id: string;
  /** 逻辑请求 ID。 */
  request_id: string;
  /** 部署 ID。 */
  deployment_id: string;
  /** 渠道 ID。 */
  channel_id: string;
  /** 实际上游模型 ID。 */
  upstream_model: string;
  /** 尝试开始时间。 */
  started_at: string;
  /** 完成时间，未完成为 null。 */
  completed_at: string | null;
  /** 上游 HTTP 状态，未知时为 null。 */
  http_status: number | null;
  /** running、succeeded、rejected、failed、cancelled 或 unknown。 */
  status: string;
  /** 首个有效内容事件距请求开始的毫秒数。 */
  first_output_ms: number | null;
}
/** Relay 运行时初始化依赖，数据库和表来自 AIService。 */
export interface RelayInitialization {
  /** 当前 Service 的数据库能力。 */
  database: ServiceDatabaseContext;
  /** 按 AIService 局部名称查找数据表。 */
  table: <T extends Record<string, unknown>>(name: string) => CityTableApi<T>;
  /** 已注册模型目录。 */
  models: AIModelDefinition[];
}
/** 目录版本和内容的同一时点快照。 */
export interface RelayCatalogSnapshot {
  /** 已校验的完整目录。 */
  catalog: RelayCatalog;
  /** 写入时必须提交的乐观锁版本。 */
  revision: number;
}
/** 实例内缓存的目录快照。 */
export interface RelayCatalogCache extends RelayCatalogSnapshot {
  /** 缓存到期的 Unix 毫秒时间。 */
  expires_at: number;
}
/** 配置成功后返回的新版本。 */
export interface RelayCatalogUpdated {
  /** 已持久化的目录版本。 */
  revision: number;
}
/** 用户 Key 列表。 */
export interface RelayKeyList {
  /** 不含摘要的 Key 信息。 */
  items: RelayKeyInfo[];
}
/** 调用日志分页结果。 */
export interface RelayRequestPage {
  /** 按开始时间倒序排列的请求。 */
  items: RelayRequestLog[];
}
/** 一个请求的上游尝试列表。 */
export interface RelayAttemptList {
  /** 按开始时间排列的尝试。 */
  items: RelayAttemptRecord[];
}
/** 共享数据库中的部署健康冷却。 */
export interface RelayHealthRecord extends Record<string, unknown> {
  /** 部署稳定 ID。 */
  deployment_id: string;
  /** 冷却结束的 Unix 毫秒时间。 */
  cooldown_until: number;
}
/** SDK 上游异常中允许参与故障恢复判断的字段。 */
export interface RelayUpstreamFailure {
  /** 适配器返回的 HTTP 状态，与现有异常契约保持一致。 */
  statusCode?: number;
  /** 适配器是否确认请求在生成前被拒绝。 */
  upstream_rejected?: boolean;
  /** 从 Retry-After 解析的等待毫秒数。 */
  retry_after_ms?: number;
}
