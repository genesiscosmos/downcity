/**
 * 第三方 Plugin ESM 制品加载器。
 *
 * 关键点（中文）
 * - 动态导入只存在于用户显式安装并信任的 Plugin 扩展边界。
 * - 加载前重新校验真实路径仍位于安装目录，防止入口在安装后被替换为路径逃逸。
 * - Factory 同时承载 Plugin 实例化与可选 Resource Resolver，不进入 Agent SDK。
 */

import { pathToFileURL } from "node:url";
import path from "node:path";
import fs from "fs-extra";
import { get_installed_plugin } from "@/city/process/registry/PluginRepository.js";
import { get_installed_plugin_dir_path } from "@/city/process/registry/CityPaths.js";
import { resolve_plugin_artifact_path } from "@/city/process/plugin/PluginInstaller.js";
import type { ExternalPluginFactory } from "@/city/types/plugin/PluginManifest.js";

/** 安全加载一个已安装第三方 Plugin 的 Factory。 */
export async function load_external_plugin_factory(
  plugin_name: string,
): Promise<ExternalPluginFactory> {
  const installed = get_installed_plugin(plugin_name);
  if (!installed) throw new Error(`Plugin is not installed: ${plugin_name}`);
  const plugin_dir = get_installed_plugin_dir_path(plugin_name);
  const expected_entry = resolve_plugin_artifact_path(
    plugin_dir,
    installed.manifest.entry,
    "entry",
  );
  const [real_root, real_entry, installed_entry] = await Promise.all([
    fs.realpath(plugin_dir),
    fs.realpath(expected_entry),
    fs.realpath(installed.entry_path),
  ]);
  if (!real_entry.startsWith(`${real_root}${path.sep}`) || real_entry !== installed_entry) {
    throw new Error(`Installed Plugin entry is invalid: ${plugin_name}`);
  }
  const module = await import(pathToFileURL(real_entry).href) as {
    /** 推荐的命名导出。 */
    plugin_factory?: ExternalPluginFactory;

    /** 兼容 ESM default factory 导出。 */
    default?: ExternalPluginFactory;
  };
  const factory = module.plugin_factory ?? module.default;
  if (!factory || typeof factory.create !== "function") {
    throw new Error(`Plugin entry must export plugin_factory.create: ${plugin_name}`);
  }
  return factory;
}
