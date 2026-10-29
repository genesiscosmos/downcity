/** Payment 路由的纯投影、参数与 provider 选择工具，不持有业务状态。 */
import { normalizeOptionalText } from "./helpers.js";
import type { PaymentProvider, PaymentProviderWebhookEvent, PaymentProviderWebhookInput, PaymentRecord, PaymentEventRecord, PaymentOrderSnapshot, PaymentStatus } from "./types.js";
/** 读取正安全整数。 */
export function read_positive_integer(value: unknown, label: string): number {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return normalized;
}

/** 读取结构化 metadata。 */
export function read_metadata(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/** 稳定序列化 Checkout 请求 metadata，用于完整幂等冲突检查。 */
export function stable_stringify(value: unknown): string {
  return JSON.stringify(sort_json_value(value));
}

/** 递归排序 JSON 对象字段。 */
export function sort_json_value(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sort_json_value);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sort_json_value(item)]),
  );
}

/** 解析数据库中的 metadata JSON。 */
export function read_metadata_json(value: string): Record<string, unknown> {
  try {
    return read_metadata(JSON.parse(value || "{}"));
  } catch {
    return {};
  }
}

/** 移除仅供内部并发控制使用的 Checkout 租约。 */
export function without_checkout_lease(value: Record<string, unknown>): Record<string, unknown> {
  const { checkout_lease: _checkout_lease, ...metadata } = value;
  return metadata;
}

/** 将持久化 Payment 投影为 Provider 所需的只读订单快照。 */
export function to_order_snapshot(row: PaymentRecord): PaymentOrderSnapshot {
  return {
    payment_id: row.payment_id,
    user_id: row.user_id,
    credits: row.credits,
    amount_minor: row.amount_minor,
    currency: row.currency,
    note: row.note,
  };
}

/**
 * 读取指定 provider。
 */
export function readProvider(providers: PaymentProvider[], value: unknown): PaymentProvider {
  const id = normalizeOptionalText(value);
  if (!id) throw new TypeError("payment method_id is required");
  const provider = providers.find((item) => item.id === id);
  if (!provider) throw new Error(`Payment provider ${id} is not available`);
  return provider;
}

/**
 * 根据请求特征识别 webhook 来源 provider。
 */
export function readWebhookProvider(providers: PaymentProvider[], request: Request): PaymentProvider | undefined {
  const url = new URL(request.url);
  const explicit = normalizeOptionalText(url.searchParams.get("provider"));
  if (explicit) return readProvider(providers, explicit);

  if (request.headers.has("stripe-signature")) return providers.find((provider) => provider.id === "stripe");
  if (request.headers.has("creem-signature")) return providers.find((provider) => provider.id === "creem");
  if (request.headers.has("x-waffo-signature")) return providers.find((provider) => provider.id === "waffo");
  if (request.headers.has("webhook-signature") || request.headers.has("svix-signature")) {
    return providers.find((provider) => provider.id === "dodo");
  }
  return undefined;
}

/**
 * 自动尝试所有 provider 解析 webhook。
 */
export async function autoParseWebhook(
  providers: PaymentProvider[],
  input: PaymentProviderWebhookInput,
): Promise<PaymentProviderWebhookEvent> {
  for (const provider of providers) {
    try {
      const event = await provider.parseWebhook(input);
      return {
        ...event,
        meta: {
          ...(event.meta ?? {}),
          provider: provider.id,
        },
      };
    } catch {
      // 关键点（中文）：自动识别只是兜底，单个 provider 解析失败继续尝试下一个。
    }
  }
  throw new Error("Payment webhook provider is required");
}

/**
 * 支付记录按更新时间倒序。
 */
export function sortPayments(rows: PaymentRecord[]): PaymentRecord[] {
  return [...rows].sort((left, right) => {
    if (left.updated_at === right.updated_at) return right.created_at.localeCompare(left.created_at);
    return right.updated_at.localeCompare(left.updated_at);
  });
}

/**
 * 事件记录按创建时间倒序。
 */
export function sortEvents(rows: PaymentEventRecord[]): PaymentEventRecord[] {
  return [...rows].sort((left, right) => right.created_at.localeCompare(left.created_at));
}
