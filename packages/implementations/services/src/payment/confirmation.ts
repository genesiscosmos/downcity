/** 支付金额投影：只接受 Provider 已验签字段，不读取客户端或订单 metadata 的申请金额。 */

/** 读取最小单位安全整数；缺失、字符串或负数都不是可信金额。 */
export function read_minor_amount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/** 将已验签的十进制金额字符串精确转成币种最小单位，不使用浮点四舍五入。 */
export function decimal_minor_amount(value: unknown, currency: string): number | undefined {
  if (typeof value !== "string" || !/^[A-Z]{3}$/.test(currency.toUpperCase())) return undefined;
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return undefined;
  let digits: number;
  try {
    digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch { return undefined; }
  const fraction = match[2] ?? "";
  if (fraction.length > digits && /[1-9]/.test(fraction.slice(digits))) return undefined;
  const amount = BigInt(match[1]!) * 10n ** BigInt(digits) + BigInt(fraction.slice(0, digits).padEnd(digits, "0") || "0");
  return amount <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(amount) : undefined;
}

/** Stripe 的独立税费和运费不购买额度；只接收可核对的 subtotal-discount 本金。 */
export function stripe_principal(object: Record<string, unknown>): number | undefined {
  const details = object.total_details as Record<string, unknown> | undefined;
  const subtotal = read_minor_amount(object.amount_subtotal);
  const total = read_minor_amount(object.amount_total);
  const discount = read_minor_amount(details?.amount_discount);
  const tax = read_minor_amount(details?.amount_tax);
  const shipping = read_minor_amount(details?.amount_shipping);
  if (subtotal === undefined || total === undefined || discount === undefined || tax === undefined || shipping === undefined) return undefined;
  const principal = subtotal - discount;
  if (principal < 0 || !Number.isSafeInteger(principal) || principal + tax + shipping !== total) return undefined;
  return principal;
}
