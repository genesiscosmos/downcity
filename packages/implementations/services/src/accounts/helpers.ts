/**
 * Accounts 子模块通用工具函数。
 *
 * 关键说明（中文）
 * - 被 service 与 providers 共享。
 * - 只放纯工具，避免 provider 和 service 之间产生循环依赖。
 */

import type { EnvRequirement } from "@downcity/federation";
import type { AccountsProvider } from "./types.js";

/**
 * 校验并去重 provider 列表。
 */
export function normalizeAccountsProviders(providers: AccountsProvider[] = []): AccountsProvider[] {
  const normalized: AccountsProvider[] = [];
  for (const provider of providers) {
    if (!provider?.id?.trim()) throw new TypeError("accounts provider id is required");
    if (normalized.find((item) => item.id === provider.id)) {
      throw new TypeError(`Duplicate accounts provider: ${provider.id}`);
    }
    normalized.push(provider);
  }
  return normalized;
}

/**
 * 合并 env 配置，按 key 去重。
 */
export function mergeAccountsEnvRequirements(items: EnvRequirement[]): EnvRequirement[] {
  const result: EnvRequirement[] = [];
  for (const item of items) {
    if (result.find((existing) => existing.key === item.key)) continue;
    result.push(item);
  }
  return result;
}
