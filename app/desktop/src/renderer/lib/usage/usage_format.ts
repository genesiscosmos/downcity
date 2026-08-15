/** Desktop 账户用量的本地化格式化规则。 */

/** 按 Federation 汇率将 Credits 格式化为美元金额。 */
export function format_credits_as_usd(credits: number, credits_per_usd = 1_000_000): string {
  const amount = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(credits / credits_per_usd);
  return `$${amount}`;
}
