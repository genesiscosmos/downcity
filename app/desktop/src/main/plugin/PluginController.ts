/**
 * Desktop Plugin catalog、Profile 外壳与 Renderer runtime 控制器。
 *
 * Profile 的创建、引用和删除由宿主统一管理；只有声明 Config 的 Plugin 才能持有
 * Profile。业务工作区与设置中心分别调用独立的 action gateway。
 */

import fs from "node:fs";
import type { PluginJsonValue } from "@downcity/city/plugin";
import {
  normalize_profile_id,
  verify_local_installed_plugin_integrity,
  type LocalPluginDefinition,
} from "@downcity/city/local";
import type {
  DesktopCreatePluginProfileInput,
  DesktopInvokePluginActionInput,
  DesktopPluginDefinition,
  DesktopPluginSummary,
} from "../../common/types/DesktopApi.js";
import { create_desktop_builtin_plugin_registrations } from "../agent/DesktopAgentAssembly.js";
import type { DesktopLocalData } from "../agent/DesktopLocalData.js";
import type { ResolvedDesktopPlugin } from "../types/plugin/PluginController.js";
import {
  create_installed_plugin_icon_url,
  create_installed_plugin_renderer_url,
} from "./PluginRendererProtocol.js";

/** 管理 Desktop 当前可见的 Plugin、Profile 和 Mainview。 */
export class PluginController {
  constructor(
    private readonly data: DesktopLocalData,
    private readonly invoke_host_action: (
      plugin_id: string,
      action_id: string,
      input?: PluginJsonValue,
    ) => Promise<PluginJsonValue>,
    private readonly invoke_config: (
      plugin_id: string,
      profile_id: string,
      action_id: string,
      input?: PluginJsonValue,
    ) => Promise<PluginJsonValue>,
  ) {}

  /** 列出统一 Plugin catalog。 */
  async list(): Promise<DesktopPluginSummary[]> {
    const builtin = create_desktop_builtin_plugin_registrations(this.data)
      .map((registration): ResolvedDesktopPlugin => ({
        definition: to_builtin_definition(registration),
        source: "builtin",
        registration,
      }));
    const installed = await Promise.all(this.data.plugins.list_installed().map(async (item) => {
      await verify_local_installed_plugin_integrity(
        this.data.plugins.plugin_path(item.id),
        item,
      );
      return {
        definition: to_installed_definition(item),
        source: "installed" as const,
        installed: item,
      };
    }));
    return [...builtin, ...installed]
      .map((plugin) => this.create_summary(plugin))
      .sort((left, right) => left.title.localeCompare(right.title));
  }

  /** 读取 Plugin 定义、Profile 列表和可选第三方 Mainview URL。 */
  async get(plugin_id: string): Promise<DesktopPluginDefinition> {
    const plugin = await this.resolve_plugin(plugin_id);
    const renderer_url = plugin.installed
      ? create_installed_plugin_renderer_url(plugin.installed)
      : undefined;
    const readme = plugin.installed
      ? this.data.plugins.read_installed_readme(
        plugin.installed.id,
        plugin.installed.readme,
      )
      : fs.readFileSync(plugin.definition.readme, "utf8");
    return {
      ...this.create_summary(plugin),
      ...(readme?.trim() ? { readme } : {}),
      ...(renderer_url ? { renderer_url } : {}),
    };
  }

  /** 创建一个空 Profile；配置内容随后由 Plugin Mainview 写入。 */
  async create_profile(
    plugin_id: string,
    input: DesktopCreatePluginProfileInput,
  ): Promise<DesktopPluginDefinition> {
    const plugin = await this.resolve_plugin(plugin_id);
    if (!plugin.definition.has_config) {
      throw new Error(`Plugin does not provide Config: ${plugin_id}`);
    }
    const profile_id = normalize_profile_id(input.profile_id);
    if (this.data.plugins.get_profile(plugin_id, profile_id)) {
      throw new Error(`Plugin Profile already exists: ${plugin_id}/${profile_id}`);
    }
    this.data.plugins.save_profile(plugin_id, profile_id, {});
    return await this.get(plugin_id);
  }

  /** 删除未被任何 Agent 引用的 Profile。 */
  async remove_profile(
    plugin_id: string,
    profile_id_input: string,
  ): Promise<DesktopPluginDefinition> {
    const plugin = await this.resolve_plugin(plugin_id);
    if (!plugin.definition.has_config) {
      throw new Error(`Plugin does not provide Config: ${plugin_id}`);
    }
    const profile_id = normalize_profile_id(profile_id_input);
    const agent_ids = this.data.agents.list()
      .filter((agent) => agent.plugins[plugin_id]?.profile === profile_id)
      .map((agent) => agent.agent_id);
    if (agent_ids.length > 0) {
      throw new Error(`Profile ${plugin_id}/${profile_id} is used by Agent: ${agent_ids.join(", ")}`);
    }
    this.data.plugins.remove_profile(plugin_id, profile_id);
    return await this.get(plugin_id);
  }

  /** 按业务工作区或 Config 范围调用 Plugin 宿主管理 action。 */
  async invoke(plugin_id: string, input: DesktopInvokePluginActionInput) {
    if (input.surface === "mainview") {
      return await this.invoke_host_action(
        plugin_id,
        input.action_id,
        input.input,
      );
    }
    return await this.invoke_config(
      plugin_id,
      input.profile_id,
      input.action_id,
      input.input,
    );
  }

  /** 解析内置或第三方 Plugin，不执行运行入口。 */
  private async resolve_plugin(plugin_id: string): Promise<ResolvedDesktopPlugin> {
    const registration = create_desktop_builtin_plugin_registrations(this.data)
      .find((item) => item.plugin.name === plugin_id);
    if (registration) {
      return { definition: to_builtin_definition(registration), source: "builtin", registration };
    }
    const installed = this.data.plugins.get_installed(plugin_id);
    if (!installed) throw new Error(`Plugin not found: ${plugin_id}`);
    await verify_local_installed_plugin_integrity(
      this.data.plugins.plugin_path(plugin_id),
      installed,
    );
    return {
      definition: to_installed_definition(installed),
      source: "installed",
      installed,
    };
  }

  /** 从定义、Profile 和 Agent 引用创建 Renderer catalog 摘要。 */
  private create_summary(plugin: ResolvedDesktopPlugin): DesktopPluginSummary {
    const profile_ids = Object.keys(
      this.data.plugins.read_config(plugin.definition.id).profiles,
    ).sort();
    const icon_url = plugin.installed
      ? create_installed_plugin_icon_url(plugin.installed)
      : undefined;
    const agent_ids = this.data.agents.list()
      .filter((agent) => Boolean(agent.plugins[plugin.definition.id]))
      .map((agent) => agent.agent_id);
    return {
      plugin_id: plugin.definition.id,
      title: plugin.definition.title || plugin.definition.id,
      description: plugin.definition.description || "",
      ...(plugin.installed ? { version: plugin.installed.version } : {}),
      ...(icon_url ? { icon_url } : {}),
      source: plugin.source,
      agent_ids,
      profile_count: plugin.definition.has_config ? profile_ids.length : 0,
      profile_ids: plugin.definition.has_config ? profile_ids : [],
      has_main: plugin.definition.has_main,
      has_sidebar: plugin.definition.has_sidebar,
      has_mainview: plugin.definition.has_mainview,
      has_config: plugin.definition.has_config,
    };
  }
}

/** 把内建 City 注册投影为 Desktop catalog 定义。 */
function to_builtin_definition(
  registration: NonNullable<ResolvedDesktopPlugin["registration"]>,
): LocalPluginDefinition {
  return {
    id: registration.plugin.name,
    title: registration.plugin.title || registration.plugin.name,
    description: registration.plugin.description,
    readme: registration.readme,
    has_main: true,
    has_sidebar: registration.has_sidebar,
    has_mainview: registration.has_mainview,
    has_config: registration.has_config,
  };
}

/** 把第三方安装清单投影为统一静态定义。 */
function to_installed_definition(
  installed: NonNullable<ResolvedDesktopPlugin["installed"]>,
): LocalPluginDefinition {
  return {
    id: installed.id,
    ...(installed.title ? { title: installed.title } : {}),
    description: installed.description,
    readme: installed.readme,
    ...(installed.icon ? { icon: installed.icon } : {}),
    has_main: Boolean(installed.main),
    has_sidebar: installed.renderer?.sidebar === true,
    has_mainview: installed.renderer?.mainview === true,
    has_config: installed.renderer?.config === true,
  };
}
