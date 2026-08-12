/**
 * Payment 子模块通用工具函数。
 *
 * 关键点（中文）
 * - 被 service、routes、providers 共享的纯工具函数集中在这里。
 * - 不包含任何路由或 provider 特定逻辑。
 */

import type { EnvRequirement } from "@downcity/federation";
import type { PaymentMethodItem, PaymentProvider } from "./types.js";

/**
 * 校验并去重 provider 列表。
 */
export function normalizeProviders(providers: PaymentProvider[]): PaymentProvider[] {
  const normalized: PaymentProvider[] = [];
  for (const provider of providers) {
    if (!provider?.id?.trim()) throw new TypeError("payment provider id is required");
    if (normalized.find((item) => item.id === provider.id)) {
      throw new TypeError(`Duplicate payment provider: ${provider.id}`);
    }
    normalized.push(provider);
  }
  return normalized;
}

/**
 * 合并 env 配置，按 key 去重。
 */
export function mergeEnvRequirements(items: EnvRequirement[]): EnvRequirement[] {
  const result: EnvRequirement[] = [];
  for (const item of items) {
    if (result.find((existing) => existing.key === item.key)) continue;
    result.push(item);
  }
  return result;
}

/**
 * 生成标准支付方式返回项。
 */
export function paymentMethodItem(input: {
  id: string;
  enabled: boolean;
  label: string;
  currency: string;
}): PaymentMethodItem {
  return {
    id: input.id,
    type: "checkout",
    enabled: input.enabled,
    label: input.label,
    service: "payment",
    action: "checkout/create",
    requires_user: true,
    currency: input.currency,
    reason: input.enabled ? undefined : "not_configured",
  };
}

/**
 * 读取对象 ID。
 */
export function readObjectId(object: Record<string, unknown>): string {
  return normalizeOptionalText(object.id);
}

/**
 * 读取必填字符串。
 */
export function normalizeRequired(value: unknown, label: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new TypeError(`${label} is required`);
  return normalized;
}

/**
 * 读取可选字符串。
 */
export function normalizeOptionalText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * 读取币种字符串。
 */
export function normalizeCurrency(value: unknown): string {
  return normalizeOptionalText(value).toLowerCase();
}

/**
 * 读取错误消息。
 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 返回 HTML Response。
 */
export function htmlResponse(html: string): Response {
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

/**
 * 渲染 payment 重定向结果页。
 */
export function renderRedirectPage(input: {
  title: string;
  heading: string;
  description: string;
  request: Request;
}): string {
  const homeURL = escapeHTML(new URL("/", input.request.url).toString());
  const title = escapeHTML(input.title);
  const heading = escapeHTML(input.heading);
  const description = escapeHTML(input.description);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      :root { color-scheme: light; --bg: #f5f7fb; --card: #fff; --text: #142033; --muted: #5a6a85; --border: #d9e2f1; --accent: #1f6feb; }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; background: linear-gradient(180deg, #f8fbff 0%, var(--bg) 100%); color: var(--text); font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      main { width: min(100%, 560px); padding: 32px; border: 1px solid var(--border); border-radius: 20px; background: var(--card); box-shadow: 0 18px 60px rgba(16, 24, 40, 0.08); }
      h1 { margin: 0 0 12px; font-size: 28px; line-height: 1.2; }
      p { margin: 0; color: var(--muted); }
      a { display: inline-block; margin-top: 24px; color: #fff; background: var(--accent); text-decoration: none; padding: 12px 16px; border-radius: 999px; font-weight: 600; }
    </style>
  </head>
  <body>
    <main>
      <h1>${heading}</h1>
      <p>${description}</p>
      <a href="${homeURL}">Return to Downcity</a>
    </main>
  </body>
</html>`;
}

/**
 * 转义 HTML。
 */
export function escapeHTML(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * 生成随机 ID（兼容 Node 和 Workers）。
 */
export function randomId(): string {
  const buffer = new Uint8Array(12);
  crypto.getRandomValues(buffer);
  return btoa(String.fromCharCode(...buffer))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/u, "");
}
