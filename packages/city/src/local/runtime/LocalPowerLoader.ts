/**
 * 本地 City Power Loader。
 *
 * Loader 只解析内置或第三方统一注册。Power 实例不由 Loader 创建；同一个入口
 * 导出的实例直接交给 City，由 City 统一持有生命周期。逐项加载结果保留成功注册
 * 与原始失败，严格列表接口则在存在失败时拒绝整批请求。
 */

import path from "node:path";
import { calculate_local_power_integrity } from "./PowerPackageIntegrity.js";
import { select_power_renderer, DESKTOP_RENDERER_PROTOCOLS } from "../../power/RendererBindings.js";
import { pathToFileURL } from "node:url";
import fs from "fs-extra";
import type {
  CityPowerRegistration,
  PowerDefinition,
} from "@/power/index.js";
import type {
  LocalInstalledPowerDefinition,
  LocalPowerLoadResult,
  LocalPowerRegistration,
} from "@/local/types/LocalPower.js";
import type { LocalPowerLoaderOptions } from "@/local/types/LocalRuntime.js";

/** 根据本地文件协议解析 City Power 注册与宿主配置。 */
export class LocalPowerLoader {
  /** 当前宿主注入的内置 Power 注册。 */
  private readonly builtin_registrations: readonly LocalPowerRegistration[];

  constructor(private readonly options: LocalPowerLoaderOptions) {
    this.builtin_registrations = [...(options.power_registrations ?? [])];
  }

  /** 按稳定 ID 加载一个内置或第三方 City Power 注册。 */
  async load_power_registration(power_id: string): Promise<CityPowerRegistration | null> {
    const builtin = this.builtin_registrations.find((item) => item.power.name === power_id);
    if (builtin) return builtin;
    return await this.load_installed_registration(power_id);
  }

  /**
   * 逐项加载 Power 注册，完整保留各项失败，供宿主按 Power 隔离故障。
   *
   * 内置注册始终保留；已安装 Power 的定义读取、校验与导入互不影响。目录枚举自身失败
   * 仍向调用方抛出；未提供 main 的 Power 沿用单项加载语义，不产生注册。
   */
  async load_registrations(): Promise<LocalPowerLoadResult> {
    const { definitions, failures } = this.options.power_repository.list_installed_results();
    const installed = await Promise.allSettled(
      definitions.map(async (definition) => await this.load_installed_registration(definition.id)),
    );
    const result: LocalPowerLoadResult = {
      registrations: [...this.builtin_registrations],
      failures: [...failures],
    };
    for (const [index, item] of installed.entries()) {
      if (item.status === "rejected") {
        result.failures.push({ power_id: definitions[index]!.id, error: item.reason });
      } else if (item.value !== null) {
        result.registrations.push(item.value);
      }
    }
    return result;
  }

  /** 列出全部 Power 注册；任一已安装 Power 加载失败时以聚合异常拒绝请求。 */
  async list_registrations(): Promise<CityPowerRegistration[]> {
    const result = await this.load_registrations();
    if (result.failures.length > 0) {
      throw new AggregateError(
        result.failures.map((failure) => failure.error),
        `Failed to load installed Powers: ${result.failures.map((failure) => failure.power_id).join(", ")}`,
      );
    }
    return result.registrations;
  }

  /** 从第三方 Power 根目录加载并校验统一 main 模块。 */
  private async load_installed_registration(
    power_id: string,
  ): Promise<CityPowerRegistration | null> {
    const definition = this.options.power_repository.get_installed(power_id);
    if (!definition) return null;
    const power_root = this.options.power_repository.power_path(power_id);
    await verify_local_installed_power_integrity(power_root, definition);
    if (!definition.main) return null;
    const expected_main = resolve_power_path(power_root, definition.main);
    const [real_root, real_entry] = await Promise.all([
      fs.realpath(power_root),
      fs.realpath(expected_main),
    ]);
    if (!real_entry.startsWith(`${real_root}${path.sep}`)) {
      throw new Error(`Installed Power entry is invalid: ${power_id}`);
    }
    const power = await load_local_city_power(real_entry, definition.integrity);
    if (power.name !== definition.id) {
      throw new Error(`Installed Power ID does not match its instance: ${definition.id}`);
    }
    const renderer = select_power_renderer(definition.renderers, DESKTOP_RENDERER_PROTOCOLS)?.binding.capabilities;
    return {
      readme: resolve_power_path(power_root, definition.readme),
      has_config: renderer?.config === true,
      has_page: renderer?.page === true,
      power,
    };
  }
}

/**
 * 加载并校验第三方统一 City Power 入口。
 *
 * cache_key 随安装制品变化，避免进程内更新后命中 Node ESM 旧缓存。
 */
export async function load_local_city_power(
  main_path: string,
  cache_key: string,
): Promise<PowerDefinition> {
  const module_url = pathToFileURL(main_path);
  module_url.searchParams.set("integrity", cache_key);
  const loaded = await import(module_url.href) as { default?: unknown };
  return normalize_local_power(loaded.default);
}

/** 校验第三方入口默认导出的唯一 Power 实例。 */
function normalize_local_power(value: unknown): PowerDefinition {
  if (is_power_definition(value)) return value;
  throw new Error("Power entry must default export one Power instance");
}

/** 判断未知值是否满足 Power 最小定义。 */
function is_power_definition(value: unknown): value is PowerDefinition {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const power = value as Partial<PowerDefinition>;
  return typeof power.name === "string" && power.name.trim().length > 0;
}

/** 校验安装制品完整性，防止已安装入口或运行资源被静默替换。 */
export async function verify_local_installed_power_integrity(
  power_root: string,
  definition: LocalInstalledPowerDefinition,
): Promise<void> {
  const actual_integrity = await calculate_local_power_integrity(power_root, definition);
  if (actual_integrity !== definition.integrity) {
    throw new Error(`Installed Power integrity check failed: ${definition.id}`);
  }
}

/** 安全解析 Power 根目录内的入口。 */
function resolve_power_path(root_path: string, relative_path: string): string {
  const root = path.resolve(root_path);
  const resolved = path.resolve(root, relative_path);
  if (resolved === root || !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("Power entry must stay inside the Power directory");
  }
  return resolved;
}
