/**
 * City Power 定义与唯一配置业务仓储。
 *
 * Power 的代码和配置全部位于 `powers/<power_id>/`，Agent 不保存 Power 引用。
 */

import {
  normalize_power_id as normalize_local_power_id,
  type LocalInstalledPowerDefinition,
} from "@downcity/city/local";
import type { JsonObject } from "@downcity/agent";
import { with_cli_local_data } from "@/city/runtime/LocalData.js";
import { create_cli_builtin_power_registrations } from "@/city/runtime/AgentAssembly.js";
import { resolve_power_catalog_item } from "@/city/process/power/PowerCatalog.js";

/** City 导出的全部内建 Power ID。 */
export const BUILTIN_POWER_IDS = Object.freeze(
  create_cli_builtin_power_registrations().map((registration) => registration.power.name),
);

/** 规范化 Power 稳定 ID。 */
export function normalize_power_id(input: string): string {
  return normalize_local_power_id(input);
}

/** 判断 Power 是否由 City 内建数组导出。 */
export function is_builtin_power(power_id_input: string): boolean {
  return BUILTIN_POWER_IDS.includes(normalize_power_id(power_id_input));
}

/** 列出全部第三方 Power。 */
export function list_installed_powers(): LocalInstalledPowerDefinition[] {
  return with_cli_local_data((data) => data.powers.list_installed());
}

/** 读取指定第三方 Power。 */
export function get_installed_power(power_id_input: string): LocalInstalledPowerDefinition | null {
  const power_id = normalize_power_id(power_id_input);
  return with_cli_local_data((data) => data.powers.get_installed(power_id));
}

/** 删除一个第三方 Power 目录。 */
export function remove_installed_power(power_id_input: string): LocalInstalledPowerDefinition {
  const power_id = normalize_power_id(power_id_input);
  if (is_builtin_power(power_id)) throw new Error("Builtin Powers cannot be uninstalled");
  const installed = get_installed_power(power_id);
  if (!installed) throw new Error(`Power is not installed: ${power_id}`);
  with_cli_local_data((data) => data.powers.remove_installed(power_id));
  return installed;
}

/** 读取一个 Power 的唯一配置。 */
export function get_power_config(power_id_input: string): JsonObject {
  const power_id = normalize_power_id(power_id_input);
  return with_cli_local_data((data) => data.powers.get_config(power_id));
}

/** 保存一个由 Power 自己负责校验的唯一配置。 */
export async function save_power_config(
  power_id_input: string,
  config: JsonObject,
): Promise<JsonObject> {
  const power_id = normalize_power_id(power_id_input);
  const power = await resolve_power_catalog_item(power_id);
  if (!power) throw new Error(`Power not found: ${power_id}`);
  return with_cli_local_data((data) => data.powers.set_config(power_id, config));
}
