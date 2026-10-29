/**
 * Payment 服务路由与事件处理。
 *
 * 关键点（中文）
 * - 被 PaymentService.install() 调用，完成所有 /v1/payment/* 路由注册。
 * - PaymentService 自己拥有支付订单；paid 后通过 on_paid 通知接入方发放 Credits。
 */

import { httpError, type ServiceInstallContext } from "@downcity/federation";
import type { PaymentInbox } from "./PaymentInbox.js";
import type { PaymentEntitlement } from "./types/Wallet.js";
import { read_entitlement } from "./wallet.js";
import { read_positive_integer, read_metadata, stable_stringify, read_metadata_json, without_checkout_lease, to_order_snapshot, readProvider, readWebhookProvider, autoParseWebhook, sortPayments, sortEvents } from "./route-utils.js";
import { resolvePaymentRedirectURL } from "./redirect.js";
import {
  errorMessage,
  htmlResponse,
  normalizeOptionalText,
  normalizeRequired,
  renderRedirectPage,
} from "./helpers.js";
import type {
  PaymentCheckoutCreateResult,
  PaymentCheckoutCreationClaim,
  PaymentCreateCheckoutInput,
  PaymentEventRecord,
  PaymentEventSyncStatus,
  PaymentProvider,
  PaymentProviderWebhookEvent,
  PaymentRecord,
  PaymentStatus,
  PaymentTopupResolutionInput,
} from "./types.js";

/**
 * payments 表操作抽象。
 */
type PaymentTable = {
  select(where?: Partial<PaymentRecord>): Promise<PaymentRecord[]>;
  insert(row: PaymentRecord): Promise<unknown>;
  update(input: {
    where: Partial<PaymentRecord>;
    values: Partial<PaymentRecord>;
  }): Promise<number>;
};

/**
 * payment_events 表操作抽象。
 */
type EventTable = {
  select(where?: Partial<PaymentEventRecord>): Promise<PaymentEventRecord[]>;
  insert(row: PaymentEventRecord): Promise<unknown>;
  update(input: {
    where: Partial<PaymentEventRecord>;
    values: Partial<PaymentEventRecord>;
  }): Promise<number>;
};

const PAYMENT_EVENT_LEASE_PREFIX = "lease:";
/** Checkout 创建租约，超时后允许其他请求使用同一 payment_id 接管。 */
const PAYMENT_CHECKOUT_CREATION_LEASE_MS = 5 * 60 * 1000;

/**
 * PaymentService 暴露给 routes 的最小能力。
 *
 * 关键点（中文）
 * - 使用 interface 避免 routes.ts 与 service.ts 之间的循环类型依赖。
 */
interface PaymentServiceLike {
  /** 宿主明确公布的充值策略，未声明为 null。 */
  get_topup_policy?(): { /** 结算币种。 */ currency: string; /** 最低minor金额。 */ minimum_minor: number } | null | undefined;
  /** 服务端解析套餐冻结权益。 */
  resolve_plan?(plan_id: string, current?: PaymentRecord): Promise<PaymentEntitlement>;
  /** 根据自由充值金额解析服务端 Credits 快照。 */
  resolve_topup(input: PaymentTopupResolutionInput): Promise<{ credits: number }>;
  /** 通知接入方处理已确认支付订单。 */
  on_paid(record: PaymentRecord): Promise<void>;
  /** 获取已挂载的 provider 列表。 */
  getProviders(): PaymentProvider[];
  /** 已安装的持久化支付事件执行器。 */
  inbox: PaymentInbox;
}

/**
 * 注册 Payment 服务路由。
 */
export function installPaymentRoutes(service: PaymentServiceLike, ctx: ServiceInstallContext): void {
  const providers = service.getProviders();
  const payments = ctx.table<PaymentRecord>("payments") as PaymentTable;
  const events = ctx.table<PaymentEventRecord>("events") as EventTable;

  ctx.route({
    method: "GET",
    path: "/methods",
    auth: [],
    handler(requestCtx) {
      return requestCtx.jsonResponse({
        items: providers.map((provider) => ({ ...provider.method(ctx), supports_card_purchase: provider.supports_card_purchase === true })),
        topup: service.get_topup_policy?.() ?? null,
      });
    },
  });

  ctx.route({
    method: "POST",
    path: "/checkout/create",
    auth: ["user"],
    async handler(requestCtx) {
      const body = await requestCtx.json<PaymentCreateCheckoutInput>();
      if (["credits", "amount_minor", "duration_seconds", "success_url", "cancel_url", "redirect_url"].some(key => key in body) || Object.keys(read_metadata(body.metadata)).length) {
        throw new TypeError("checkout only accepts topup_amount_minor; Credits are resolved by the server");
      }
      const provider = readProvider(providers, body.method_id || body.provider);
      const method = provider.method(ctx);
      if (!method.enabled) {
        const reason = method.reason ? `: ${method.reason}` : "";
        return requestCtx.jsonResponse({ error: `Payment provider ${provider.id} is disabled${reason}` }, 400);
      }

      const user_id = normalizeRequired(requestCtx.user?.user_id, "user_id");
      const idempotency_key = normalizeRequired(body.idempotency_key, "idempotency_key");
      const note = normalizeOptionalText(body.note);
      const payment_id = await create_stable_payment_id(provider.id, user_id, idempotency_key);
      const current_payment = (await payments.select({ payment_id }))[0];
      const plan_id = body.plan_id ? normalizeRequired(body.plan_id, "plan_id") : "";
      if (plan_id && (body.topup_amount_minor !== undefined || !provider.supports_card_purchase || !service.resolve_plan)) throw new TypeError("card purchase not supported or conflicting amount");
      const entitlement = plan_id ? await service.resolve_plan!(plan_id, current_payment) : { kind: "topup" as const, plan: null };
      if (current_payment && read_entitlement(current_payment).kind !== entitlement.kind) throw new TypeError("payment intent differs");
      const amount_minor = entitlement.plan?.amount_minor ?? read_positive_integer(body.topup_amount_minor, "topup_amount_minor");
      if (entitlement.plan && entitlement.plan.currency !== method.currency.toLowerCase()) throw new TypeError("plan currency does not match payment method");
      const credits = current_payment?.credits ?? entitlement.plan?.credits ?? read_positive_integer((await service.resolve_topup({ user_id, provider: provider.id, currency: method.currency, topup_amount_minor: amount_minor })).credits, "resolved credits");
      const reservation = await claim_checkout_creation({
        payments,
        payment_id,
        provider: provider.id,
        method_currency: method.currency,
        user_id,
        credits,
        amount_minor,
        idempotency_key,
        note,
        metadata: { wallet_entitlement: entitlement },
      });
      if (reservation.ready) {
        return requestCtx.jsonResponse(toCheckoutResult(reservation.record));
      }
      if (!reservation.claimed) {
        return requestCtx.jsonResponse({
          error: "Checkout creation is already in progress",
          payment_id: reservation.record.payment_id,
        }, 409);
      }

      const successURL = resolvePaymentRedirectURL({
        path: "/v1/payment/redirect/success",
        ctx,
        request: requestCtx.request,
      });
      const cancelURL = resolvePaymentRedirectURL({
        path: "/v1/payment/redirect/cancel",
        ctx,
        request: requestCtx.request,
      });

      try {
        const created = await provider.createCheckout({
          payment_id: reservation.record.payment_id,
          payment: to_order_snapshot(reservation.record),
          request: requestCtx.request,
          ctx,
          success_url: successURL,
          cancel_url: cancelURL,
        });
        const row = await finish_checkout_creation({
          payments,
          reservation,
          created,
          provider: provider.id,
        });
        return requestCtx.jsonResponse(toCheckoutResult(row));
      } catch (error) {
        await fail_checkout_creation(payments, reservation).catch(() => undefined);
        throw error;
      }
    },
  });

  ctx.route({
    method: "GET",
    path: "/payments/me",
    auth: ["user"],
    async handler(requestCtx) {
      const userId = normalizeRequired(requestCtx.user?.user_id, "user_id");
      return requestCtx.jsonResponse({ items: sortPayments(await payments.select({ user_id: userId })).map(row => ({ payment_id: row.payment_id, provider: row.provider, status: row.status, credits: row.credits, amount_minor: row.amount_minor, currency: row.currency, created_at: row.created_at, updated_at: row.updated_at })) });
    },
  });

  ctx.route({
    method: "GET",
    path: "/payments",
    auth: ["admin"],
    async handler(requestCtx) {
      return requestCtx.jsonResponse({ items: sortPayments(await payments.select()) });
    },
  });

  ctx.route({
    method: "GET",
    path: "/events",
    auth: ["admin"],
    async handler(requestCtx) {
      return requestCtx.jsonResponse({ items: sortEvents(await events.select()) });
    },
  });

  ctx.route({
    method: "POST",
    path: "/webhook",
    auth: [],
    async handler(requestCtx) {
      const raw = await requestCtx.text();
      const provider = readWebhookProvider(providers, requestCtx.request);
      let webhookEvent: PaymentProviderWebhookEvent;

      try {
        webhookEvent = provider
          ? await provider.parseWebhook({ raw, request: requestCtx.request, ctx })
          : await autoParseWebhook(providers, { raw, request: requestCtx.request, ctx });
      } catch (error) {
        return requestCtx.jsonResponse({ error: errorMessage(error) }, 400);
      }

      const eventProvider = provider ?? readProvider(providers, webhookEvent.meta?.provider);
      const eventId = `${eventProvider.id}:${normalizeRequired(webhookEvent.event_id, "payment event id")}`;
      let event_record = (await events.select({ event_id: eventId }))[0];
      if (!event_record) {
        const pending_event: PaymentEventRecord = {
          event_id: eventId,
          provider: eventProvider.id,
          type: webhookEvent.type,
          payload_json: JSON.stringify(webhookEvent.payload),
          sync_status: "pending",
          sync_error: "",
          created_at: new Date().toISOString(),
        };
        try {
          await events.insert(pending_event);
          event_record = pending_event;
        } catch (error) {
          // 并发重复 webhook 可能同时通过首次查询，主键冲突后重新读取即可。
          event_record = (await events.select({ event_id: eventId }))[0];
          if (!event_record) throw error;
        }
      }

      try {
        const sync_status = await service.inbox.accept(eventProvider.id, webhookEvent);
        return requestCtx.jsonResponse({ received: true, event_id: eventId,
          provider: eventProvider.id, sync_status });
      } catch {
        return requestCtx.jsonResponse({ error: "payment_event_dispatch_failed", event_id: eventId }, 503);
      }
    },
  });

  ctx.route({
    method: "GET",
    path: "/redirect/success",
    auth: [],
    handler(requestCtx) {
      return htmlResponse(renderRedirectPage({
        title: "Return to wallet",
        heading: "Payment is being verified",
        description: "Only a verified payment notification can credit your wallet. Return to the wallet and refresh the order status.",
        request: requestCtx.request,
      }));
    },
  });

  ctx.route({
    method: "GET",
    path: "/redirect/cancel",
    auth: [],
    handler(requestCtx) {
      return htmlResponse(renderRedirectPage({
        title: "Payment canceled",
        heading: "Payment canceled",
        description: "No charge was completed. You can close this page and return to your app to try again later.",
        request: requestCtx.request,
      }));
    },
  });
}

/**
 * 同步 webhook 事件到本地支付订单，并在首次确认 paid 时通知接入方。
 */
export async function syncPaymentEvent(input: {
  provider: PaymentProvider;
  event: PaymentProviderWebhookEvent;
  payments: PaymentTable;
  service: PaymentServiceLike;
}): Promise<PaymentEventSyncStatus> {
  const { provider, event, payments, service } = input;
  if (event.status === "ignored") return "ignored";

  const payment = await findPaymentByWebhookEvent(payments, provider.id, event);
  // 本地 payment 可能尚未完成 Provider ID 回填；保留 pending，Provider 重发后可恢复。
  if (!payment) return "pending";
  if (event.status === "paid") {
    const external_id = event.provider_payment_id || event.provider_order_id || event.provider_session_id;
    if (!external_id || !Number.isSafeInteger(event.amount_minor) || (event.amount_minor ?? 0) <= 0
      || event.amount_minor !== payment.amount_minor
      || event.currency?.toLowerCase() !== payment.currency.toLowerCase()) {
      throw httpError(422, "verified payment amount, currency or transaction identity does not match order");
    }
    if (event.provider_session_id && payment.provider_session_id && event.provider_session_id !== payment.provider_session_id
      || event.provider_order_id && payment.provider_order_id && event.provider_order_id !== payment.provider_order_id
      || event.provider_payment_id && payment.provider_payment_id && event.provider_payment_id !== payment.provider_payment_id) {
      throw httpError(422, "verified provider identity does not match order");
    }
  }
  if (event.status === "paid" && payment.status === "paid") {
    await service.on_paid(payment);
    return "applied";
  }
  if (payment.status !== "pending" && event.status !== "paid") return "ignored";

  await updatePayment(payments, payment.payment_id, {
    status: event.status,
    provider_session_id: event.provider_session_id || payment.provider_session_id,
    provider_payment_id: event.provider_payment_id || payment.provider_payment_id,
    provider_order_id: event.provider_order_id || payment.provider_order_id,
  });
  if (event.status === "paid") await service.on_paid({ ...payment, status: "paid" });
  return "applied";
}

/**
 * 根据 webhook 事件查找对应支付记录。
 */
async function findPaymentByWebhookEvent(
  payments: PaymentTable,
  provider: string,
  event: PaymentProviderWebhookEvent,
): Promise<PaymentRecord | undefined> {
  if (event.payment_id) {
    const record = (await payments.select({ payment_id: event.payment_id, provider }))[0];
    if (record) return record;
  }
  if (event.provider_session_id) {
    const record = (await payments.select({ provider, provider_session_id: event.provider_session_id }))[0];
    if (record) return record;
  }
  if (event.provider_payment_id) {
    const record = (await payments.select({ provider, provider_payment_id: event.provider_payment_id }))[0];
    if (record) return record;
  }
  if (event.provider_order_id) {
    const record = (await payments.select({ provider, provider_order_id: event.provider_order_id }))[0];
    if (record) return record;
  }
  return undefined;
}

/**
 * 原子占用某个用户支付意图的 Checkout 创建权。
 *
 * 关键说明（中文）
 * - payment_id 由 provider + user_id + idempotency_key 稳定生成，数据库主键承担并发唯一约束。
 * - 空 checkout_url 表示创建中；租约过期或失败记录可由下一次请求接管。
 */
async function claim_checkout_creation(input: {
  payments: PaymentTable;
  payment_id: string;
  provider: string;
  method_currency: string;
  user_id: string;
  credits: number;
  amount_minor: number;
  idempotency_key: string;
  note: string;
  metadata: Record<string, unknown>;
}): Promise<PaymentCheckoutCreationClaim> {
  let current = (await input.payments.select({ payment_id: input.payment_id }))[0];
  const current_metadata = current ? read_metadata_json(current.metadata_json) : {};
  const current_request_metadata = read_metadata(current_metadata.checkout_request_metadata);
  if (current && (
    current.user_id !== input.user_id
    || current.amount_minor !== input.amount_minor
    || current.currency !== input.method_currency
    || current.note !== input.note
    || stable_stringify(current_request_metadata) !== stable_stringify(input.metadata)
  )) {
    throw new Error("idempotency_key was already used with different payment parameters");
  }
  if (current?.status === "pending" && current.checkout_url) {
    return { claimed: false, ready: true, record: current, lease_metadata_json: "" };
  }
  if (current?.status === "paid") {
    return { claimed: false, ready: true, record: current, lease_metadata_json: "" };
  }

  const now = new Date().toISOString();
  const lease_metadata_json = JSON.stringify({
    ...input.metadata,
    checkout_request_metadata: input.metadata,
    checkout_lease: `${PAYMENT_EVENT_LEASE_PREFIX}${Date.now() + PAYMENT_CHECKOUT_CREATION_LEASE_MS}`,
    provider: input.provider,
  });
  if (!current) {
    const record: PaymentRecord = {
      payment_id: input.payment_id,
      provider: input.provider,
      user_id: input.user_id,
      idempotency_key: input.idempotency_key,
      provider_session_id: "",
      provider_payment_id: "",
      provider_order_id: "",
      credits: input.credits,
      amount_minor: input.amount_minor,
      currency: input.method_currency,
      status: "pending",
      checkout_url: "",
      note: input.note,
      metadata_json: lease_metadata_json,
      created_at: now,
      updated_at: now,
    };
    try {
      await input.payments.insert(record);
      return { claimed: true, ready: false, record, lease_metadata_json };
    } catch (error) {
      current = (await input.payments.select({ payment_id: input.payment_id }))[0];
      if (!current) throw error;
    }
  }

  if (current.status === "pending" && !current.checkout_url) {
    const updated_at = Date.parse(current.updated_at);
    if (Number.isFinite(updated_at) && Date.now() - updated_at < PAYMENT_CHECKOUT_CREATION_LEASE_MS) {
      return { claimed: false, ready: false, record: current, lease_metadata_json: "" };
    }
  }

  const changed = await input.payments.update({
    where: {
      payment_id: current.payment_id,
      status: current.status,
      checkout_url: current.checkout_url,
      metadata_json: current.metadata_json,
    },
    values: {
      status: "pending",
      checkout_url: "",
      metadata_json: lease_metadata_json,
      updated_at: now,
    },
  });
  if (changed === 0) {
    const latest = (await input.payments.select({ payment_id: current.payment_id }))[0] ?? current;
    return {
      claimed: false,
      ready: latest.status === "paid" || Boolean(latest.checkout_url),
      record: latest,
      lease_metadata_json: "",
    };
  }
  return {
    claimed: true,
    ready: false,
    record: {
      ...current,
      status: "pending",
      checkout_url: "",
      metadata_json: lease_metadata_json,
      updated_at: now,
    },
    lease_metadata_json,
  };
}

/** 将 Provider 创建结果写回仍由当前请求持有的 payment 占位记录。 */
async function finish_checkout_creation(input: {
  payments: PaymentTable;
  reservation: PaymentCheckoutCreationClaim;
  created: Awaited<ReturnType<PaymentProvider["createCheckout"]>>;
  provider: string;
}): Promise<PaymentRecord> {
  const values: Partial<PaymentRecord> = {
    provider_session_id: normalizeOptionalText(input.created.provider_session_id),
    provider_payment_id: normalizeOptionalText(input.created.provider_payment_id),
    provider_order_id: normalizeOptionalText(input.created.provider_order_id),
    checkout_url: input.created.checkout_url,
    metadata_json: JSON.stringify({
      ...without_checkout_lease(read_metadata_json(input.reservation.lease_metadata_json)),
      provider: input.provider,
      ...(input.created.metadata ?? {}),
    }),
    updated_at: new Date().toISOString(),
  };
  const changed = await input.payments.update({
    where: {
      payment_id: input.reservation.record.payment_id,
      metadata_json: input.reservation.lease_metadata_json,
    },
    values,
  });
  const latest = (await input.payments.select({ payment_id: input.reservation.record.payment_id }))[0];
  if (changed === 0 || !latest) {
    throw new Error(`Payment checkout lease lost: ${input.reservation.record.payment_id}`);
  }
  return latest;
}

/** Provider 创建失败时释放占位记录，使后续请求可立即重试。 */
async function fail_checkout_creation(
  payments: PaymentTable,
  reservation: PaymentCheckoutCreationClaim,
): Promise<void> {
  await payments.update({
    where: {
      payment_id: reservation.record.payment_id,
      status: "pending",
      metadata_json: reservation.lease_metadata_json,
    },
    values: {
      status: "failed",
      updated_at: new Date().toISOString(),
    },
  });
}

/** 为 provider + user + idempotency_key 生成跨进程稳定的 Payment 主键。 */
async function create_stable_payment_id(provider: string, user_id: string, idempotency_key: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${provider}:${user_id}:${idempotency_key}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const suffix = Array.from(new Uint8Array(digest).slice(0, 16))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  return `pay_${suffix}`;
}

/**
 * 更新支付记录。
 */
async function updatePayment(
  payments: PaymentTable,
  paymentId: string,
  input: {
    status: PaymentStatus;
    provider_session_id?: string;
    provider_payment_id?: string;
    provider_order_id?: string;
  },
): Promise<void> {
  await payments.update({
    // 非付款成功事件只允许推进 pending，旧快照不能覆盖已确认 paid。
    where: { payment_id: paymentId, ...(input.status === "paid" ? {} : { status: "pending" as const }) },
    values: {
      status: input.status,
      provider_session_id: normalizeOptionalText(input.provider_session_id),
      provider_payment_id: normalizeOptionalText(input.provider_payment_id),
      provider_order_id: normalizeOptionalText(input.provider_order_id),
      updated_at: new Date().toISOString(),
    },
  });
}

/**
 * 把 payment 行转成 checkout 创建结果。
 */
function toCheckoutResult(row: PaymentRecord): PaymentCheckoutCreateResult {
  return {
    payment_id: row.payment_id,
    provider: row.provider,
    provider_session_id: row.provider_session_id,
    provider_payment_id: row.provider_payment_id,
    provider_order_id: row.provider_order_id,
    checkout_url: row.checkout_url,
    status: row.status,
    credits: row.credits,
    topup_amount_minor: row.amount_minor,
    currency: row.currency,
  };
}
