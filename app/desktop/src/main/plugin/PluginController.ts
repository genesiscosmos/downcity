/**
 * Desktop Plugin catalog 与 Profile 配置控制器。
 *
 * 该控制器统一处理内置和第三方 Plugin，负责定义解析、Schema 校验、明文 TOML
 * 持久化以及删除前的 Agent 引用检查。
 */

import type { JsonObject } from "@downcity/agent";
import {
  normalize_profile_id,
  validate_local_plugin_config,
  type LocalPluginDefinition,
} from "@downcity/local/product";
import type {
  DesktopPluginDefinition,
  DesktopPluginSummary,
  DesktopSavePluginProfileInput,
} from "../../common/types/DesktopApi.js";
import { create_desktop_builtin_plugin_registrations, list_desktop_plugins } from "../agent/DesktopAgentAssembly.js";
import type { DesktopLocalData } from "../agent/DesktopLocalData.js";

/** 管理 Desktop 当前可见的 Plugin 定义与 Profile。 */
export class PluginController {
  constructor(private readonly data: DesktopLocalData) {}

  /** 列出统一 Plugin catalog。 */
  list(): DesktopPluginSummary[] {
    return list_desktop_plugins(this.data);
  }

  /** 读取一份 Plugin 定义和全部 Profile。 */
  get(plugin_id: string): DesktopPluginDefinition {
    const { definition, summary } = this.require_definition(plugin_id);
    const config = this.data.plugins.read_config(plugin_id);
    return {
      ...summary,
      ...(definition.config ? { config_schema: structuredClone(definition.config.schema) } : {}),
      default_config: structuredClone(definition.config?.defaults ?? {}),
      profiles: structuredClone(config.profiles),
    };
  }

  /** 校验并保存一个 Profile。 */
  save_profile(plugin_id: string, input: DesktopSavePluginProfileInput): DesktopPluginDefinition {
    const { definition } = this.require_definition(plugin_id);
    if (!definition.config) throw new Error(`Plugin does not require configuration: ${plugin_id}`);
    const profile_id = normalize_profile_id(input.profile_id);
    validate_local_plugin_config(input.config, definition.config.schema, `${plugin_id}.${profile_id}`);
    this.data.plugins.save_profile(plugin_id, profile_id, input.config);
    return this.get(plugin_id);
  }

  /** 删除未被任何 Agent 引用的 Profile。 */
  remove_profile(plugin_id: string, profile_id_input: string): DesktopPluginDefinition {
    this.require_definition(plugin_id);
    const profile_id = normalize_profile_id(profile_id_input);
    const agent_ids = this.data.agents.list()
      .filter((agent) => {
        const reference = agent.plugins[plugin_id];
        return reference && (reference.profile || "default") === profile_id;
      })
      .map((agent) => agent.agent_id);
    if (agent_ids.length > 0) {
      throw new Error(`Profile ${plugin_id}/${profile_id} is used by Agent: ${agent_ids.join(", ")}`);
    }
    this.data.plugins.remove_profile(plugin_id, profile_id);
    return this.get(plugin_id);
  }

  /** 解析内置或第三方 Plugin，并读取对应 catalog 摘要。 */
  private require_definition(plugin_id: string): { definition: LocalPluginDefinition; summary: DesktopPluginSummary } {
    const builtin = create_desktop_builtin_plugin_registrations(this.data)
      .find((registration) => registration.definition.id === plugin_id)?.definition;
    const definition = builtin ?? this.data.plugins.get_installed(plugin_id);
    const summary = this.list().find((plugin) => plugin.plugin_id === plugin_id);
    if (!definition || !summary) throw new Error(`Plugin not found: ${plugin_id}`);
    return { definition, summary };
  }
}
