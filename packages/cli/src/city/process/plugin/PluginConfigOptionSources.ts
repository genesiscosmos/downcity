/**
 * Plugin 通用配置表单的动态资源选项来源。
 *
 * 关键点（中文）
 * - 表单只识别 Schema 声明的 `resource_type`，不识别 Plugin 名称和字段路径。
 * - 每种可信 City 资源在注册表中拥有唯一 Provider，Manifest 不能注入执行代码。
 */

import { PlatformStore } from "@/city/runtime/store/index.js";
import type {
  PluginConfigResourceOption,
} from "@/city/types/plugin/PluginCatalog.js";
import type {
  PluginConfigResourceProvider,
  PluginConfigResourceQuery,
} from "@/city/types/plugin/PluginConfigForm.js";
import type { JsonObject } from "@downcity/agent";
import type { StoredChannelAccountChannel } from "@downcity/plugins/chat";

const RESOURCE_PROVIDERS: Readonly<Record<string, PluginConfigResourceProvider>> = {
  channel_account: list_channel_account_options,
};

/** 查询 Schema 资源选择器需要展示的选项。 */
export function list_plugin_config_resource_options(
  query: PluginConfigResourceQuery,
): PluginConfigResourceOption[] {
  const provider = RESOURCE_PROVIDERS[query.resource_type];
  if (!provider) throw new Error(`Unsupported Plugin config resource: ${query.resource_type}`);
  return provider(query.filter);
}

/** 从 City 加密账号池生成 Chat account 选项。 */
function list_channel_account_options(filter: JsonObject | undefined): PluginConfigResourceOption[] {
  const channel_value = typeof filter?.channel === "string" ? filter.channel : undefined;
  const channel = channel_value === "telegram" || channel_value === "feishu" || channel_value === "qq"
    ? channel_value as StoredChannelAccountChannel
    : undefined;
  const store = new PlatformStore();
  try {
    return store.listChannelAccountsSync(channel).map((account) => ({
      value: account.id,
      label: account.identity ? `${account.name} (${account.identity})` : account.name,
      description: account.id,
    }));
  } finally {
    store.close();
  }
}
