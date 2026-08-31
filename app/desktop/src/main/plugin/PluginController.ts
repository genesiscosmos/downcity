/**
 * Desktop Plugin catalog、Profile 外壳与 Mainview runtime 控制器。
 *
 * Profile 的创建、引用和删除由宿主统一管理；具体配置只由 Plugin main action 读写。
 * Renderer 永远拿不到 Profile 原始配置，只能通过当前 Plugin/Profile 绑定的 action gateway。
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { PluginMainModule } from "@downcity/plugin";
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

/** 管理 Desktop 当前可见的 Plugin、Profile 和 Mainview。 */
export class PluginController {
  /** Plugin main 的唯一生命周期拥有者。 */
  private readonly main_runtime: PluginMainRuntime;

  constructor(private readonly data: DesktopLocalData) {
    this.main_runtime = new PluginMainRuntime(data, {
      resolve_main: async (plugin_id) => {
        const plugin = await this.resolve_plugin(plugin_id);
        const module = plugin.registration?.main
          ?? await this.load_installed_main(plugin);
        return module ? { plugin_id, module } : null;
      },
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

  /** 读取 Plugin 定义、Profile 列表和可选 Mainview HTML。 */
  async get(plugin_id: string): Promise<DesktopPluginDefinition> {
    const plugin = await this.resolve_plugin(plugin_id);
    const renderer_html = await this.read_renderer_html(plugin);
    return {
      ...this.create_summary(plugin),
      ...(renderer_html ? { renderer_html } : {}),
    };
  }

  /** 创建一个空 Profile；配置内容随后由 Plugin Mainview 写入。 */
  async create_profile(
    plugin_id: string,
    input: DesktopCreatePluginProfileInput,
  ): Promise<DesktopPluginDefinition> {
    await this.resolve_plugin(plugin_id);
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
    await this.resolve_plugin(plugin_id);
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

  /** 在当前 Profile 范围内调用 Plugin main action。 */
  async invoke(plugin_id: string, input: DesktopInvokePluginActionInput) {
    return await this.main_runtime.invoke(
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

  /** 读取自包含 Mainview HTML，不加载其中脚本。 */
  private async read_renderer_html(
    plugin: ResolvedDesktopPlugin,
  ): Promise<string | null> {
    if (plugin.registration?.renderer_html) return plugin.registration.renderer_html;
    if (!plugin.installed?.renderer) return null;
    const renderer_path = resolve_installed_entry(
      this.data.plugins.plugin_path(plugin.installed.id),
      plugin.installed.renderer,
    );
    return fs.readFileSync(renderer_path, "utf8");
  }

  /** 从定义、Profile 和 Agent 引用创建 Renderer catalog 摘要。 */
  private create_summary(plugin: ResolvedDesktopPlugin): DesktopPluginSummary {
    const profile_ids = Object.keys(
      this.data.plugins.read_config(plugin.definition.id).profiles,
    ).sort();
    const agent_ids = this.data.agents.list()
      .filter((agent) => Boolean(agent.plugins[plugin.definition.id]))
      .map((agent) => agent.agent_id);
    return {
      plugin_id: plugin.definition.id,
      title: plugin.definition.title || plugin.definition.id,
      description: plugin.definition.description || "",
      ...(plugin.installed ? { version: plugin.installed.version } : {}),
      source: plugin.source,
      agent_ids,
      profile_count: profile_ids.length,
      profile_ids,
      has_agent: plugin.definition.has_agent,
      has_main: plugin.definition.has_main,
      has_renderer: plugin.definition.has_renderer,
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
    ...(installed.icon ? { icon: installed.icon } : {}),
    has_agent: Boolean(installed.agent),
    has_main: Boolean(installed.main),
    has_renderer: Boolean(installed.renderer),
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
