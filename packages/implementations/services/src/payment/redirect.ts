/**
 * Payment 跳转地址解析模块。
 *
 * 关键说明（中文）
 * - 所有 payment provider 的内置结果页都统一基于 DOWNCITY_CITY_BASE_URL 生成。
 * - 保留当前请求 origin 作为最后兜底，避免本地开发或测试环境必须预先写入 env。
 * - 不再允许每个 provider 通过 SUCCESS_URL / CANCEL_URL / RETURN_URL 分散覆盖默认跳转页。
 */

/**
 * Payment 内置结果页路径。
 */
export type PaymentRedirectPath =
  | `/v1/payment/redirect/${"success" | "cancel"}`
  | `/v1/payment.${string}/redirect/${"success" | "cancel"}`;

/**
 * Payment 跳转地址解析参数。
 */
export interface ResolvePaymentRedirectURLInput {
  /**
   * City service install context 的 env 读取函数。
   */
  ctx: {
    /**
     * 读取 City runtime env。
     */
    env(key: string): string | undefined;
  };

  /**
   * 当前 checkout/create 请求。
   */
  request: Request;

  /**
   * payment provider 暴露的内置结果页路径。
   */
  path: PaymentRedirectPath;
}

/**
 * 解析 payment provider 默认跳转地址。
 */
export function resolvePaymentRedirectURL(input: ResolvePaymentRedirectURLInput): string {
  const fromBaseURL = buildBaseURLRedirect(input.ctx.env("DOWNCITY_CITY_BASE_URL"), input.path);
  if (fromBaseURL) return fromBaseURL;

  const fromRequestOrigin = buildRequestOriginRedirect(input.request, input.path);
  if (fromRequestOrigin) return fromRequestOrigin;

  throw new TypeError("DOWNCITY_CITY_BASE_URL or request origin is required for payment redirect URL");
}

/**
 * 基于 City 对外地址生成内置结果页 URL。
 */
function buildBaseURLRedirect(baseURL: string | undefined, path: string): string {
  const normalizedBaseURL = String(baseURL ?? "").trim().replace(/\/+$/u, "");
  if (!normalizedBaseURL) return "";
  return `${normalizedBaseURL}${path}`;
}

/**
 * 基于当前请求 origin 生成内置结果页 URL。
 */
function buildRequestOriginRedirect(request: Request, path: string): string {
  try {
    return new URL(path, request.url).toString();
  } catch {
    return "";
  }
}
