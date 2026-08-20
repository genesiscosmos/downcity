/**
 * Desktop Plugin catalog 与 Profile 配置控制器。
 *
 * 该控制器统一处理内置和第三方 Plugin，负责定义解析、Schema 校验、明文 TOML
 * 持久化以及删除前的 Agent 引用检查。
 */

import path from "node:path";
import type { JsonObject } from "@downcity/agent";
import {
  accepts_empty_local_plugin_config,
  create_local_plugin_config_draft,
  load_local_plugin_setup_module,
  verify_local_installed_plugin_integrity,
  normalize_profile_id,
  redact_local_plugin_write_only_values,
  restore_local_plugin_write_only_values,
  validate_local_plugin_config,
  type LocalPluginDefinition,
} from "@downcity/local/product";
import type {
  DesktopPluginDefinition,
  DesktopPluginSource,
  DesktopPluginSummary,
  DesktopSavePluginProfileInput,
} from "../../common/types/DesktopApi.js";
import { create_desktop_builtin_plugin_registrations } from "../agent/DesktopAgentAssembly.js";
import type { DesktopLocalData } from "../agent/DesktopLocalData.js";

/** 管理 Desktop 当前可见的 Plugin 定义与 Profile。 */
export class PluginController {
  constructor(private readonly data: DesktopLocalData) {}

  /** 列出统一 Plugin catalog。 */
  async list(): Promise<DesktopPluginSummary[]> {
    const builtin_definitions = create_desktop_builtin_plugin_registrations(this.data)
      .map((registration) => registration.definition);
    const installed_definitions = await Promise.all(
      this.data.plugins.list_installed().map(async (installed) => ({
        definition: await this.load_installed_definition(installed.id),
        source: "installed" as const,
      })),
    );
    return [
      ...builtin_definitions.map((definition) => ({ definition, source: "builtin" as const })),
      ...installed_definitions,
    ]
      .map(({ definition, source }) => this.create_summary(definition, source))
      .sort((left, right) => left.title.localeCompare(right.title));
  }

  /** 读取一份 Plugin 定义和全部 Profile。 */
  async get(plugin_id: string): Promise<DesktopPluginDefinition> {
    const { definition, summary } = await this.resolve_definition(plugin_id);
    const config = this.data.plugins.read_config(plugin_id);
    return {
      ...summary,
      ...(definition.config ? { config_schema: structuredClone(definition.config.schema) } : {}),
      initial_config: definition.config
        ? create_local_plugin_config_draft(definition.config.schema)
        : {},
      profiles: Object.fromEntries(Object.entries(config.profiles).map(([profile_id, profile]) => [
        profile_id,
        definition.config
          ? redact_local_plugin_write_only_values(profile, definition.config.schema)
          : structuredClone(profile),
      ])),
    };
  }

  /** 校验并保存一个 Profile。 */
  async save_profile(plugin_id: string, input: DesktopSavePluginProfileInput): Promise<DesktopPluginDefinition> {
    const { definition } = await this.resolve_definition(plugin_id);
    if (!definition.config) throw new Error(`Plugin does not require configuration: ${plugin_id}`);
    const profile_id = normalize_profile_id(input.profile_id);
    const current = this.data.plugins.get_profile(plugin_id, profile_id) ?? {};
    const config = restore_local_plugin_write_only_values(
      input.config,
      current,
      definition.config.schema,
    );
    validate_local_plugin_config(config, definition.config.schema, `${plugin_id}.${profile_id}`);
    this.data.plugins.save_profile(plugin_id, profile_id, config);
    return await this.get(plugin_id);
  }

  /** 删除未被任何 Agent 引用的 Profile。 */
  async remove_profile(plugin_id: string, profile_id_input: string): Promise<DesktopPluginDefinition> {
    await this.resolve_definition(plugin_id);
    const profile_id = normalize_profile_id(profile_id_input);
    const agent_ids = this.data.agents.list()
      .filter((agent) => {
        const reference = agent.plugins[plugin_id];
        return reference?.profile === profile_id;
      })
      .map((agent) => agent.agent_id);
    if (agent_ids.length > 0) {
      throw new Error(`Profile ${plugin_id}/${profile_id} is used by Agent: ${agent_ids.join(", ")}`);
    }
    this.data.plugins.remove_profile(plugin_id, profile_id);
    return await this.get(plugin_id);
  }

  /** 解析内置或第三方 Plugin，并读取对应 catalog 摘要。 */
  private async resolve_definition(plugin_id: string): Promise<{ definition: LocalPluginDefinition; summary: DesktopPluginSummary }> {
    const builtin = create_desktop_builtin_plugin_registrations(this.data)
      .find((registration) => registration.definition.id === plugin_id)?.definition;
    if (builtin) {
      return { definition: builtin, summary: this.create_summary(builtin, "builtin") };
    }
    const definition = await this.load_installed_definition(plugin_id);
    return { definition, summary: this.create_summary(definition, "installed") };
  }

  /** 加载第三方 Plugin setup 导出的配置协议，但不执行 setup。 */
  private async load_installed_definition(plugin_id: string): Promise<LocalPluginDefinition> {
    const installed = this.data.plugins.get_installed(plugin_id);
    if (!installed) throw new Error(`Plugin not found: ${plugin_id}`);
    const plugin_root = this.data.plugins.plugin_path(plugin_id);
    await verify_local_installed_plugin_integrity(plugin_root, installed);
    const setup_module = await load_local_plugin_setup_module(
      path.join(plugin_root, installed.setup),
      installed.integrity,
    );
    return { ...installed, config: { schema: setup_module.schema } };
  }

  /** 从定义、全局 profile 和 Agent 引用创建 Renderer catalog 摘要。 */
  private create_summary(
    definition: LocalPluginDefinition,
    source: DesktopPluginSource,
  ): DesktopPluginSummary {
    const profile_ids = Object.keys(this.data.plugins.read_config(definition.id).profiles).sort();
    const agent_ids = this.data.agents.list()
      .filter((agent) => Boolean(agent.plugins[definition.id]))
      .map((agent) => agent.agent_id);
    return {
      plugin_id: definition.id,
      title: definition.title || definition.id,
      description: definition.description || "",
      ...(source === "installed" && "version" in definition
        ? { version: String(definition.version) }
        : {}),
      source,
      agent_ids,
      profile_count: profile_ids.length,
      profile_ids,
      configuration: definition.config
        ? accepts_empty_local_plugin_config(definition.config.schema) ? "optional" : "required"
        : "none",
    };
  }
}
