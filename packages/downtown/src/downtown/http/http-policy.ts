/**
 * Downtown 默认 HTTP 请求分类与构造期校验。
 * 路径分类不信任 Content-Length、请求头或客户端声明的更高额度；媒体业务仍校验文件本身。
 */
import type { DowntownHttpLimits, DowntownHttpPolicy } from "../../types/DowntownHttp.js";

/** 可重用的规范化服务端策略，只含已校验完整值。 */
export interface ResolvedDowntownHttpPolicy {
  /** 普通 API 的限制。 */
  ordinary: DowntownHttpLimits;
  /** Webhook 的限制。 */
  webhook: DowntownHttpLimits;
  /** 同步媒体及 AI 的限制。 */
  media: DowntownHttpLimits;
  /** 模型流启动阶段限制。 */
  model_stream: DowntownHttpLimits;
  /** SSE 读取阶段整体硬期限。 */
  stream_lifetime_ms: number;
  /** 显式精确路径覆盖，值已补齐默认字段。 */
  routes: Map<string, DowntownHttpLimits>;
}

const limit_keys = ["max_body_bytes", "body_timeout_ms", "execution_timeout_ms"] as const;
const ordinary = { max_body_bytes: 1_048_576, body_timeout_ms: 15_000, execution_timeout_ms: 30_000 };
const webhook = { ...ordinary, max_body_bytes: 2_097_152 };
const media = { max_body_bytes: 41_943_040, body_timeout_ms: 60_000, execution_timeout_ms: 180_000 };

/** 拒绝未知字段和无效数字，防止配置错误悄悄取消保护。 */
function merge_limits(base: DowntownHttpLimits, input?: Partial<DowntownHttpLimits>): DowntownHttpLimits {
  if (input === undefined) return { ...base };
  if (!input || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).some((key) => !limit_keys.includes(key as typeof limit_keys[number]))) throw new Error("Invalid HTTP limits");
  const result = { ...base, ...input };
  for (const key of limit_keys) {
    const maximum = key === "max_body_bytes" ? 268_435_456 : 2_147_483_647;
    if (!Number.isSafeInteger(result[key]) || result[key] < 1 || result[key] > maximum) throw new Error(`Invalid HTTP limit: ${key}`);
  }
  return result;
}

/** 完整校验一次，不在每次请求读取服务器配置文件或进程环境。 */
export function resolve_http_policy(input: DowntownHttpPolicy = {}): ResolvedDowntownHttpPolicy {
  if (!input || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).some((key) => !["ordinary", "webhook", "media", "model_stream", "stream_lifetime_ms", "routes"].includes(key))) {
    throw new Error("Invalid Downtown HTTP policy");
  }
  const policy: ResolvedDowntownHttpPolicy = {
    ordinary: merge_limits(ordinary, input.ordinary), webhook: merge_limits(webhook, input.webhook),
    media: merge_limits(media, input.media), model_stream: merge_limits(media, input.model_stream),
    stream_lifetime_ms: input.stream_lifetime_ms ?? 900_000, routes: new Map(),
  };
  if (!Number.isSafeInteger(policy.stream_lifetime_ms) || policy.stream_lifetime_ms < 1 || policy.stream_lifetime_ms > 2_147_483_647) {
    throw new Error("Invalid stream lifetime");
  }
  if (input.routes !== undefined && !Array.isArray(input.routes)) throw new Error("HTTP routes must be an array");
  for (const route of input.routes ?? []) {
    if (!route || typeof route !== "object" || typeof route.path !== "string" || !route.path.startsWith("/")
      || route.path.includes("?") || route.path.includes("#") || route.path.includes("*") || policy.routes.has(route.path)) {
      throw new Error("HTTP route overrides require unique exact paths");
    }
    const { path, ...limits } = route;
    policy.routes.set(path, merge_limits(default_route_limits(path, policy), limits));
  }
  return policy;
}

/** 先使用默认路由类别，再按精确路径应用服务器显式覆盖。 */
export function request_http_limits(path: string, policy: ResolvedDowntownHttpPolicy): DowntownHttpLimits {
  return policy.routes.get(path) ?? default_route_limits(path, policy);
}

/** 结果轮询保持轻量；媒体和模型输入允许 Base64 包装，Webhook 独立配额。 */
function default_route_limits(path: string, policy: ResolvedDowntownHttpPolicy): DowntownHttpLimits {
  if (path === "/v1/payment/webhook") return policy.webhook;
  if (path === "/v1/ai/stream") return policy.model_stream;
  if (path === "/v1/chat/completions" || path === "/v1/ai/chat/completions") return policy.media;
  if (["image/create", "asr", "tts", "embedding", "rerank", "video", "audio", "decision"].some((action) => path === `/v1/ai/${action}`)) return policy.media;
  return policy.ordinary;
}
