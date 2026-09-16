/**
 * 出站 HTTP 统一入口。
 *
 * 关键点（中文）
 * - 需要访问公网的 Downcity 能力都必须经过这里，保证代理与超时语义完全一致。
 * - 代理来源按优先级读取：DOWNCITY_PROXY_URL、HTTPS_PROXY、HTTP_PROXY、ALL_PROXY。
 * - 每个请求都必须有整体超时，禁止出现「永远挂起」的连接，否则上层状态机会一直停在 connecting。
 * - 请求体语义透传：调用方传入的全局 `FormData` 会在边界归一化成 undici 实现，
 *   保证 multipart 附件上传（Telegram / 飞书文档）不会被降级成 `[object FormData]`。
 * - 错误信息只包含脱敏 endpoint，绝不把 bot token 等路径密钥写进日志或 UI。
 */

import {
  Agent,
  FormData as UndiciFormData,
  ProxyAgent,
  fetch as undici_fetch,
  type Dispatcher,
  type RequestInit as UndiciRequestInit,
} from "undici";

/** 未显式指定时的整体请求超时。 */
const DEFAULT_TIMEOUT_MS = 30_000;
/** 允许调用方覆盖的超时下限与上限。 */
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 30 * 60_000;
/** 与代理或目标建立 TCP 连接的超时。 */
const CONNECT_TIMEOUT_MS = 10_000;
/** 通过代理时与目标完成 TLS 握手的超时。 */
const TLS_TIMEOUT_MS = 15_000;

/**
 * 代理环境变量读取顺序。
 *
 * 说明（中文）
 * - DOWNCITY_PROXY_URL 由 Desktop 网络代理设置写入，优先级最高。
 * - 其余为业界通用变量，便于 CLI 与容器环境直接复用。
 */
const PROXY_ENV_KEYS = [
  "DOWNCITY_PROXY_URL",
  "HTTPS_PROXY",
  "https_proxy",
  "HTTP_PROXY",
  "http_proxy",
  "ALL_PROXY",
  "all_proxy",
] as const;

/** NO_PROXY 环境变量读取顺序。 */
const NO_PROXY_ENV_KEYS = ["DOWNCITY_NO_PROXY", "NO_PROXY", "no_proxy"] as const;

/** 出站请求失败分类。 */
export type OutboundHttpErrorCode =
  /** 超过整体超时上限。 */
  | "timeout"
  /** 连接、TLS 或传输失败。 */
  | "connect"
  /** 调用方主动取消。 */
  | "aborted";

/**
 * 出站请求参数。
 *
 * 说明（中文）
 * - 与全局 `RequestInit` 完全一致，调用方不需要感知 undici 类型。
 * - `dispatcher` 由本模块接管，调用方不能覆盖。
 * - `timeout_ms` 覆盖连接、响应头与响应体读取的总时长。
 */
export type OutboundHttpInit = Omit<RequestInit, "signal"> & {
  /** 调用方可选的主动取消信号；会与超时信号合并。 */
  signal?: AbortSignal;
  /** 本次请求的整体超时毫秒数，缺省 30 秒。 */
  timeout_ms?: number;
};

/**
 * 归一化后的出站错误。
 *
 * 说明（中文）
 * - `message` 面向用户与日志，必须可直接展示。
 * - `endpoint` 已确认不含密钥，可直接写入日志。
 */
export class OutboundHttpError extends Error {
  /** 失败分类。 */
  readonly code: OutboundHttpErrorCode;
  /** 脱敏后的请求 endpoint。 */
  readonly endpoint: string;
  /** 本次请求使用的整体超时毫秒数。 */
  readonly timeout_ms: number;
  /** 命中的代理地址；未使用代理时为空字符串。 */
  readonly proxy_url: string;

  constructor(input: {
    code: OutboundHttpErrorCode;
    endpoint: string;
    timeout_ms: number;
    proxy_url: string;
    message: string;
  }) {
    super(input.message);
    this.name = "OutboundHttpError";
    this.code = input.code;
    this.endpoint = input.endpoint;
    this.timeout_ms = input.timeout_ms;
    this.proxy_url = input.proxy_url;
  }
}

/** 按代理地址缓存的 dispatcher，代理变化时自动替换。 */
let cached_dispatcher: { proxy_url: string; dispatcher: Dispatcher } | undefined;

/**
 * 解析当前进程应使用的代理地址。
 *
 * 说明（中文）
 * - 返回空字符串表示直连。
 * - 由于 Desktop 会在运行时改写环境变量，本函数每次调用都重新读取。
 */
export function resolve_outbound_proxy_url(): string {
  for (const key of PROXY_ENV_KEYS) {
    const value = String(process.env[key] || "").trim();
    if (value) return value;
  }
  return "";
}

/** 关闭缓存中的 dispatcher，供释放或测试使用。 */
export async function close_outbound_http_dispatchers(): Promise<void> {
  const current = cached_dispatcher;
  cached_dispatcher = undefined;
  if (current) await current.dispatcher.close().catch(() => undefined);
}

/**
 * 请求一个 HTTP 地址，并强制套用统一的代理与超时策略。
 *
 * 说明（中文）
 * - 返回全局 `Response`；undici 与 Node 内置 fetch 的 Response 运行时一致。
 * - 网络类失败统一抛 `OutboundHttpError`，调用方只需读取 `message` 即可展示。
 */
export async function outbound_http_fetch(
  url: string | URL,
  init: OutboundHttpInit = {},
): Promise<Response> {
  const url_string = typeof url === "string" ? url : url.toString();
  const endpoint = to_safe_endpoint(url_string);
  const timeout_ms = normalize_timeout_ms(init.timeout_ms);
  const { dispatcher, proxy_url } = resolve_transport(url_string);
  const { timeout_ms: _declared_timeout_ms, signal, ...rest } = init;
  const timeout_signal = AbortSignal.timeout(timeout_ms);
  const request_signal = signal
    ? AbortSignal.any([signal, timeout_signal])
    : timeout_signal;

  try {
    // 关键点（中文）：undici 的 RequestInit 与全局 RequestInit 运行期一致，此处仅收敛类型。
    const response = await undici_fetch(url_string, {
      ...rest,
      body: normalize_request_body(rest.body),
      signal: request_signal,
      dispatcher,
    } as unknown as UndiciRequestInit);
    return response as unknown as Response;
  } catch (error) {
    throw to_outbound_http_error({
      error,
      endpoint,
      timeout_ms,
      proxy_url,
      timed_out: timeout_signal.aborted,
      caller_aborted: signal?.aborted === true,
    });
  }
}

/**
 * 请求并解析 JSON 响应。
 *
 * 说明（中文）
 * - 只负责传输与解析，不判断业务错误码，业务语义留给调用方。
 */
export async function outbound_http_json<T>(
  url: string | URL,
  init: OutboundHttpInit = {},
): Promise<T> {
  const response = await outbound_http_fetch(url, init);
  return (await response.json()) as T;
}

/**
 * 把请求地址转换成可安全展示的 endpoint。
 *
 * 关键点（中文）
 * - Telegram Bot API 把 token 放在路径中，必须固定脱敏。
 * - 只保留协议、主机与路径，丢弃查询参数，避免把凭据写入日志。
 */
function to_safe_endpoint(url_string: string): string {
  try {
    const url = new URL(url_string);
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/bot[^/]+/u, "/bot***")}`;
  } catch {
    return "unknown-endpoint";
  }
}

/** 计算本次请求实际生效的超时毫秒数。 */
function normalize_timeout_ms(value: number | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.trunc(parsed)));
}

/**
 * 归一化请求体，保证 undici 按调用方的原意序列化。
 *
 * 关键点（中文）
 * - Node 全局 `FormData` 与 undici 自带 `FormData` 是两个互不相通的实现，类身份不同；
 *   undici 的 fetch 不认识全局实例，会把整个 body 降级成字符串 `[object FormData]`，
 *   于是 Telegram / 飞书的 multipart 附件上传会因为请求体没有文件字段而失败。
 * - 这里在出站边界做一次等价转换：逐项复制到 undici `FormData`，保留文件名与分段 Content-Type。
 *   调用方仍可继续使用全局 `FormData` / `Blob` / `File`，不需要感知 undici 类型。
 * - 其余请求体（字符串、Buffer、URLSearchParams、全局 Blob 等）undici 能正确序列化，原样透传。
 */
function normalize_request_body(body: unknown): unknown {
  if (!is_global_form_data(body)) return body;
  const normalized = new UndiciFormData();
  for (const [name, value] of body.entries()) {
    if (typeof value === "string") {
      normalized.append(name, value);
      continue;
    }
    // 文件字段必须保留原始文件名；无名 Blob 与标准实现一致回退为 "blob"。
    normalized.append(name, value, value.name || "blob");
  }
  return normalized;
}

/** 判断请求体是否为 Node 全局 `FormData`（即 undici 无法直接序列化的那一套实现）。 */
function is_global_form_data(value: unknown): value is FormData {
  return typeof FormData !== "undefined" && value instanceof FormData;
}

/** 解析本次请求应使用的 dispatcher 与代理地址。 */
function resolve_transport(url_string: string): {
  dispatcher: Dispatcher;
  proxy_url: string;
} {
  const configured_proxy = resolve_outbound_proxy_url();
  const proxy_url = configured_proxy && !should_bypass_proxy(url_string)
    ? configure_proxy_url(configured_proxy)
    : "";
  return { dispatcher: get_dispatcher(proxy_url), proxy_url };
}

/** 取得按代理地址缓存的 dispatcher，代理变化时替换缓存。 */
function get_dispatcher(proxy_url: string): Dispatcher {
  if (cached_dispatcher?.proxy_url === proxy_url) return cached_dispatcher.dispatcher;
  const stale = cached_dispatcher;
  cached_dispatcher = { proxy_url, dispatcher: create_dispatcher(proxy_url) };
  // 关键点（中文）：close 只阻止新请求，在途长轮询仍可正常收尾。
  if (stale) void stale.dispatcher.close().catch(() => undefined);
  return cached_dispatcher.dispatcher;
}

/** 创建直连或代理 dispatcher。 */
function create_dispatcher(proxy_url: string): Dispatcher {
  if (!proxy_url) {
    return new Agent({ connect: { timeout: CONNECT_TIMEOUT_MS } });
  }
  return new ProxyAgent({
    uri: proxy_url,
    connect: { timeout: CONNECT_TIMEOUT_MS },
    requestTls: { timeout: TLS_TIMEOUT_MS },
  });
}

/**
 * 规范化代理地址。
 *
 * 说明（中文）
 * - 允许省略协议，缺省按 http 处理。
 * - undici 只支持 http/https 代理，socks 必须尽早给出可执行提示。
 */
function configure_proxy_url(value: string): string {
  const with_protocol = value.includes("://") ? value : `http://${value}`;
  let url: URL;
  try {
    url = new URL(with_protocol);
  } catch {
    throw new Error(`网络代理地址无法解析：${value}。示例：http://127.0.0.1:7890`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(
      `暂不支持 ${url.protocol}// 代理，请改用 http:// 地址（Clash、Surge 等混合端口同样接受 http://）。`,
    );
  }
  return url.toString();
}

/**
 * 判断目标地址是否命中 NO_PROXY 规则。
 *
 * 支持形式（中文）
 * - 精确主机：`example.com`
 * - 后缀匹配：`.example.com` 或 `*.example.com`
 * - IPv4 CIDR：`192.168.0.0/16`（macOS 系统例外列表常用形式）
 * - 通配全部：`*`
 *
 * 说明（中文）
 * - 无法识别的规则一律不匹配，即继续使用代理，保证“不静默绕过代理”。
 */
function should_bypass_proxy(url_string: string): boolean {
  let host: string;
  let port: string;
  try {
    const url = new URL(url_string);
    host = url.hostname.replace(/^\[|\]$/gu, "").toLowerCase();
    port = url.port;
  } catch {
    return false;
  }
  const rules = read_no_proxy_rules();
  if (rules.includes("*")) return true;
  const target_ipv4 = parse_ipv4(host);
  return rules.some((rule) => {
    const [rule_host, rule_port] = split_host_port(rule);
    if (rule_port && rule_port !== port) return false;
    if (!rule_host) return false;
    const cidr = parse_ipv4_cidr(rule_host);
    if (cidr) return target_ipv4 !== undefined && matches_ipv4_cidr(target_ipv4, cidr);
    // `*.example.com` 与 `.example.com` 语义相同：匹配自身及其子域。
    const normalized_rule = rule_host.replace(/^\*\./u, "").replace(/^\./u, "");
    if (!normalized_rule) return false;
    return host === normalized_rule || host.endsWith(`.${normalized_rule}`);
  });
}

/** 把 IPv4 字符串解析为 32 位整数；非 IPv4 返回 undefined。 */
function parse_ipv4(value: string): number | undefined {
  const parts = value.split(".");
  if (parts.length !== 4) return undefined;
  let result = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/u.test(part)) return undefined;
    const octet = Number(part);
    if (octet > 255) return undefined;
    result = (result << 8) | octet;
  }
  return result >>> 0;
}

/** 解析 `192.168.0.0/16` 形式的 CIDR；非 CIDR 返回 undefined。 */
function parse_ipv4_cidr(rule: string): { network: number; mask: number } | undefined {
  const match = /^([^/]+)\/(\d{1,2})$/u.exec(rule);
  if (!match) return undefined;
  const network = parse_ipv4(match[1]);
  const prefix = Number(match[2]);
  if (network === undefined || prefix < 0 || prefix > 32) return undefined;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return { network: (network & mask) >>> 0, mask };
}

/** 判断 IPv4 是否落在 CIDR 内。 */
function matches_ipv4_cidr(
  address: number,
  cidr: { network: number; mask: number },
): boolean {
  return ((address & cidr.mask) >>> 0) === cidr.network;
}

/** 读取 NO_PROXY 规则列表。 */
function read_no_proxy_rules(): string[] {
  const value = NO_PROXY_ENV_KEYS.map((key) => String(process.env[key] || "").trim())
    .filter(Boolean)
    .join(",");
  return value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

/** 拆分 host:port 规则，兼容 IPv6 方括号写法。 */
function split_host_port(rule: string): [string, string] {
  const match = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/u.exec(rule);
  if (!match) return [rule, ""];
  return [match[1].replace(/^\[|\]$/gu, ""), match[2] || ""];
}

/** 把底层异常归一化成用户可读的出站错误。 */
function to_outbound_http_error(input: {
  error: unknown;
  endpoint: string;
  timeout_ms: number;
  proxy_url: string;
  timed_out: boolean;
  caller_aborted: boolean;
}): OutboundHttpError {
  const { endpoint, timeout_ms, proxy_url } = input;
  const detail = describe_cause(input.error);
  if (input.timed_out) {
    return new OutboundHttpError({
      code: "timeout",
      endpoint,
      timeout_ms,
      proxy_url,
      message: proxy_url
        ? `请求超时（${format_seconds(timeout_ms)}）：经代理 ${proxy_url} 访问 ${endpoint} 无响应，请确认代理可用。`
        : `请求超时（${format_seconds(timeout_ms)}）：${endpoint} 无响应，请检查网络连通性或配置网络代理。`,
    });
  }
  if (input.caller_aborted) {
    return new OutboundHttpError({
      code: "aborted",
      endpoint,
      timeout_ms,
      proxy_url,
      message: `请求已取消：${endpoint}。`,
    });
  }
  return new OutboundHttpError({
    code: "connect",
    endpoint,
    timeout_ms,
    proxy_url,
    message: proxy_url
      ? `无法通过代理 ${proxy_url} 访问 ${endpoint}：${detail}。请确认代理进程可用。`
      : `无法访问 ${endpoint}：${detail}。若该地址需要代理，请在 Desktop 设置中配置网络代理。`,
  });
}

/** 提取底层错误中最有诊断价值的文本。 */
function describe_cause(error: unknown): string {
  const cause = (error as { cause?: unknown })?.cause;
  const cause_code = String((cause as { code?: unknown })?.code || "").trim();
  const cause_message = cause instanceof Error ? cause.message : String(cause || "").trim();
  const own_message = error instanceof Error ? error.message : String(error || "").trim();
  const base = own_message || "network error";
  if (cause_code && cause_message && cause_message !== base) {
    return `${base}: ${cause_code} ${cause_message}`;
  }
  if (cause_code) return `${base}: ${cause_code}`;
  if (cause_message && cause_message !== base) return `${base}: ${cause_message}`;
  return base;
}

/** 把毫秒格式化成便于阅读的秒数。 */
function format_seconds(milliseconds: number): string {
  const seconds = Math.round(milliseconds / 1000);
  return seconds >= 60 ? `${Math.round(seconds / 60)}min` : `${seconds}s`;
}
