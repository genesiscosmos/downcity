/** City 全局 Power Catalog。 */

import { list_installed_powers } from "@/city/process/registry/PowerRepository.js";
import { create_cli_builtin_power_registrations } from "@/city/runtime/AgentAssembly.js";
import { create_cli_local_data } from "@/city/runtime/LocalData.js";
import { verify_local_installed_power_integrity } from "@downcity/city/local";
import type { PowerCatalogItem } from "@/city/types/power/PowerCatalog.js";

/** 列出全部内置与第三方 Power。 */
export function list_power_catalog(): PowerCatalogItem[] {
  const builtin_items = create_cli_builtin_power_registrations().map((registration) => {
    return {
      power_id: registration.power.name,
      title: registration.power.title || registration.power.name,
      description: registration.power.description,
      source: "builtin" as const,
      has_main: true,
      has_sidebar: registration.has_sidebar,
      has_mainview: registration.has_mainview,
      has_config: registration.has_config,
    };
  });
  const installed_items = list_installed_powers().map((power) => ({
    power_id: power.id,
    title: power.title || power.id,
    description: power.description,
    ...(power.icon ? { icon: power.icon } : {}),
    version: power.version,
    source: "installed" as const,
    source_label: power.source,
    has_main: Boolean(power.main),
    has_sidebar: power.renderer?.sidebar === true,
    has_mainview: power.renderer?.mainview === true,
    has_config: power.renderer?.config === true,
  }));
  return [...builtin_items, ...installed_items]
    .sort((left, right) => left.power_id.localeCompare(right.power_id));
}

/**
 * 按稳定 ID 解析一个 Power 的完整管理视图。
 *
 * 解析管理视图只验证已安装制品完整性，不执行第三方 main 或 Agent 入口。
 */
export async function resolve_power_catalog_item(
  power_id: string,
): Promise<PowerCatalogItem | null> {
  const item = list_power_catalog().find((candidate) => candidate.power_id === power_id) ?? null;
  if (!item || item.source === "builtin") return item;
  const data = create_cli_local_data();
  try {
    const installed = data.powers.get_installed(power_id);
    if (!installed) return null;
    await verify_local_installed_power_integrity(data.powers.power_path(power_id), installed);
    return item;
  } finally {
    data.database.close();
  }
}
