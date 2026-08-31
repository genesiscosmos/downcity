/**
 * Desktop Plugin catalog、Profile 外壳与 Renderer runtime 控制器。
 *
 * Profile 的创建、引用和删除由宿主统一管理；只有声明 Config 的 Plugin 才能持有
 * Profile。业务工作区与设置中心分别调用独立的 action gateway。
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { PluginJsonValue, PluginMainModule } from "@downcity/plugin";
import {
  normalize_profile_id,
  verify_local_installed_plugin_integrity,
  type LocalPluginDefinition,
} from "@downcity/local/product";
import type {
  DesktopCreatePluginProfileInput,
  DesktopInvokePluginActionInput,
  DesktopPluginDefinition,
  DesktopPluginSummary,
} from "../../common/types/DesktopApi.js";
import { create_desktop_builtin_plugin_registrations } from "../agent/DesktopAgentAssembly.js";
import type { DesktopLocalData } from "../agent/DesktopLocalData.js";
import type { ResolvedDesktopPlugin } from "../types/plugin/PluginController.js";
import { PluginMainRuntime } from "./PluginMainRuntime.js";
import {
  create_installed_plugin_icon_url,
  create_installed_plugin_renderer_url,
} from "./PluginRendererProtocol.js";

/** 管理 Desktop 当前可见的 Plugin、Profile 和 Mainview。 */
export class PluginController {
  /** Plugin main 的唯一生命周期拥有者。 */
  private readonly main_runtime: PluginMainRuntime;

  constructor(
    private readonly data: DesktopLocalData,
    invoke_agent_plugin: (input: {
      /** 目标 Agent ID。 */ readonly agent_id: string;
      /** 执行上下文 Workspace ID。 */ readonly workspace_id: string;
      /** 目标 Plugin ID。 */ readonly plugin_id: string;
      /** 目标 action ID。 */ readonly action_id: string;
      /** 可选 action 输入。 */ readonly input?: PluginJsonValue;
    }) => Promise<PluginJsonValue>,
  ) {
    this.main_runtime = new PluginMainRuntime(data, {
      resolve_main: async (plugin_id) => {
        const plugin = await this.resolve_plugin(plugin_id);
        const module = plugin.registration?.main
          ?? await this.load_installed_main(plugin);
        return module ? { plugin_id, module } : null;
      },
      invoke_agent_plugin,
    });
  }

  /** 列出统一 Plugin catalog。 */
  async list(): Promise<DesktopPluginSummary[]> {
    const builtin = create_desktop_builtin_plugin_registrations(this.data)
      .map((registration): ResolvedDesktopPlugin => ({
        definition: registration.definition,
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

  /** 按业务工作区或 Config 范围调用 Plugin main action。 */
  async invoke(plugin_id: string, input: DesktopInvokePluginActionInput) {
    if (input.surface === "mainview") {
      return await this.main_runtime.invoke_plugin(
        plugin_id,
        input.action_id,
        input.input,
      );
    }
    return await this.main_runtime.invoke_config(
      plugin_id,
      input.profile_id,
      input.action_id,
      input.input,
    );
  }

  /** 关闭全部已经激活的 Plugin main。 */
  async dispose(): Promise<void> {
    await this.main_runtime.dispose();
  }

  /** 解析内置或第三方 Plugin，不执行运行入口。 */
  private async resolve_plugin(plugin_id: string): Promise<ResolvedDesktopPlugin> {
    const registration = create_desktop_builtin_plugin_registrations(this.data)
      .find((item) => item.definition.id === plugin_id);
    if (registration) {
      return { definition: registration.definition, source: "builtin", registration };
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

  /** 从已安装清单读取并校验 Plugin main 默认导出。 */
  private async load_installed_main(
    plugin: ResolvedDesktopPlugin,
  ): Promise<PluginMainModule | null> {
    if (!plugin.installed?.main) return null;
    const entry_path = resolve_installed_entry(
      this.data.plugins.plugin_path(plugin.installed.id),
      plugin.installed.main,
    );
    const url = pathToFileURL(entry_path);
    url.searchParams.set("integrity", plugin.installed.integrity);
    const loaded = await import(url.href) as { default?: unknown };
    if (!is_plugin_main_module(loaded.default)) {
      throw new Error(`Plugin main must default export a lifecycle object: ${plugin.installed.id}`);
    }
    return loaded.default;
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
      has_agent: plugin.definition.has_agent,
      has_main: plugin.definition.has_main,
      has_sidebar: plugin.definition.has_sidebar,
      has_mainview: plugin.definition.has_mainview,
      has_config: plugin.definition.has_config,
    };
  }
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
    has_agent: Boolean(installed.agent),
    has_main: Boolean(installed.main),
    has_sidebar: installed.renderer?.sidebar === true,
    has_mainview: installed.renderer?.mainview === true,
    has_config: installed.renderer?.config === true,
  };
}

/** 安全解析已安装 Plugin 根目录内的入口。 */
function resolve_installed_entry(root_input: string, relative_path: string): string {
  const root = path.resolve(root_input);
  const entry = path.resolve(root, relative_path);
  if (entry === root || !entry.startsWith(`${root}${path.sep}`)) {
    throw new Error("Plugin entry must stay inside the Plugin directory");
  }
  return entry;
}

/** 判断未知默认导出是否符合 Plugin main 生命周期协议。 */
function is_plugin_main_module(value: unknown): value is PluginMainModule {
  return Boolean(value)
    && typeof value === "object"
    && typeof (value as Partial<PluginMainModule>).activate === "function"
    && (
      (value as Partial<PluginMainModule>).deactivate === undefined
      || typeof (value as Partial<PluginMainModule>).deactivate === "function"
    );
}
