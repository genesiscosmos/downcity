/**
 * city tool namespace 注册表。
 *
 * 关键点（中文）
 * - 注册表只按 namespace 名索引 provider，不参与可见性与执行。
 * - 新增 namespace 只需要新增一个 provider 文件并加一次注册。
 */

import type { CityToolNamespaceProvider } from "@/city/types/CityTool.js";

/** 按 namespace 名索引的 provider 集合。 */
export class CityToolRegistry {
  /** 已注册的 provider，按注册顺序保留。 */
  private readonly providers_by_namespace = new Map<string, CityToolNamespaceProvider>();

  constructor(providers: readonly CityToolNamespaceProvider[] = []) {
    for (const provider of providers) {
      const namespace = String(provider.namespace || "").trim();
      if (!namespace) throw new Error("City tool namespace provider requires a name");
      if (this.providers_by_namespace.has(namespace)) {
        throw new Error(`City tool namespace already registered: ${namespace}`);
      }
      this.providers_by_namespace.set(namespace, provider);
    }
  }

  /** 返回全部 provider 的稳定快照，顺序与注册顺序一致。 */
  list(): readonly CityToolNamespaceProvider[] {
    return [...this.providers_by_namespace.values()];
  }

  /** 按 namespace 名返回 provider；不存在时返回 null。 */
  get(namespace_input: string): CityToolNamespaceProvider | null {
    const namespace = String(namespace_input || "").trim();
    if (!namespace) return null;
    return this.providers_by_namespace.get(namespace) ?? null;
  }
}
