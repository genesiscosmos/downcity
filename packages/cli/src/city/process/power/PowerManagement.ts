/**
 * CLI/TUI 的统一 Power 管理边界。稳定 ID 决定配置、更新、卸载和 Action 的所有权；
 * 单包制品与代码快照保留各自存储和租约机制，展示名从不参与选择。
 */
import fs from "fs-extra";
import { read_city_host_state } from "@downcity/city";
import type { JsonObject } from "@downcity/type";
import {
  PowerRepository, RootLease, resolve_resource_root, verify_local_installed_power_integrity,
  normalize_extension_source, LocalHostClient, ResourceError, type ExtensionResult, type ExtensionConfigurationView,
  type ExtensionPowerView, type LocalInstalledPowerDefinition,
} from "@downcity/city/local";
import { create_cli_builtin_power_registrations } from "@/city/runtime/AgentAssembly.js";
import { ExtensionClient } from "../../resources/ExtensionClient.js";
import { install_prepared_power, update_power } from "./PowerInstaller.js";
import { with_power_source } from "./PowerSource.js";

/** 面向 CLI 的单一 Power 管理条目，不包含配置值或秘密。 */
export interface ManagedPower {
  /** 管理操作使用的精确稳定 ID；代码来源沿用其 UUID。 */
  power_id: string;
  /** 安装形态；用于说明生命周期，不构成独立命令树。 */
  kind: "builtin" | "package" | "code";
  /** 仅用于展示的名称，可与其他 Power 重复。 */
  title: string;
  /** 内置能力或单包声明的用途说明。 */
  description: string;
  /** 内置标记、本地绝对路径或 Git 来源地址。 */
  source: string;
  /** 实际观察状态；installed 不表示已装载，pending 不表示可执行。 */
  status: string;
  /** 单包的完整静态安装定义，供 inspect 展示和更新使用。 */
  package?: LocalInstalledPowerDefinition;
  /** 代码来源的安全快照、操作、能力和错误状态。 */
  details?: Omit<ExtensionResult, "extension_id" | "source" | "name" | "status">;
  /** Git 来源保存的分支、tag 或 commit。 */
  ref?: string;
}

/** 将内部代码快照结果投影为统一的公开身份。 */
export function code_power_view(result: ExtensionResult): ManagedPower {
  const { extension_id, source, name, status, ...details } = result;
  return { power_id: extension_id, kind: "code", title: name, description: "", source: source.location, status, ...(source.ref ? { ref: source.ref } : {}), details };
}

/** 同一数据根的 Power 管理器，不启动宿主，也不回退绕过已发现宿主。 */
export class PowerManagement {
  /** 规范化数据根；所有底层路径与管理通道都使用同一个值。 */
  readonly root_path: string;
  /** 单包定义与配置的持久化入口。 */
  readonly repository: PowerRepository;
  /** 保留内部项目生命周期协议，集中在此路由。 */
  readonly code: ExtensionClient;

  constructor(root?: string) {
    this.root_path = resolve_resource_root(root);
    this.repository = new PowerRepository(this.root_path);
    this.code = new ExtensionClient(this.root_path);
  }

  /** 列出全部管理身份；冲突时拒绝猜测操作目标。 */
  async list(): Promise<ManagedPower[]> {
    const builtin: ManagedPower[] = create_cli_builtin_power_registrations().map(({ power }) => ({ power_id: power.name, kind: "builtin", title: power.title || power.name, description: power.description, source: "builtin", status: "builtin" }));
    const packages: ManagedPower[] = this.repository.list_installed().map((item) => ({ power_id: item.id, kind: "package", title: item.title || item.id, description: item.description, source: item.source, status: "installed", package: item }));
    const code = (await this.code.call("extension.list") as ExtensionResult[]).map(code_power_view);
    const items = [...builtin, ...packages, ...code].sort((left, right) => left.power_id.localeCompare(right.power_id));
    const identities = new Set<string>();
    for (const item of items) {
      if (identities.has(item.power_id)) throw new Error(`Power ID conflict: ${item.power_id}`);
      identities.add(item.power_id);
    }
    return items;
  }

  /** 只接受完整管理 ID，不接受标题或短 ID。已卸载代码身份仍可 inspect。 */
  async resolve(power_id: string): Promise<ManagedPower> {
    const item = (await this.list()).find((candidate) => candidate.power_id === power_id);
    if (item) return item;
    if (/^[a-f\d-]{36}$/u.test(power_id)) return code_power_view(await this.code.call("extension.show", { extension_id: power_id }) as ExtensionResult);
    throw new Error(`Power not found: ${power_id}`);
  }

  /** 根据根清单选择唯一生命周期，禁止因单包校验失败而尝试执行代码。 */
  async install(source_input: string, ref?: string, operation_id?: string): Promise<ManagedPower> {
    const origin = await normalize_extension_source(source_input, process.cwd(), ref);
    const existing = (await this.code.call("extension.list") as ExtensionResult[]).find((item) => item.source.kind === origin.kind && item.source.location === origin.location && (origin.ref ? item.source.ref === origin.ref || item.source.ref === `refs/heads/${origin.ref}` || item.source.ref === `refs/tags/${origin.ref}` : origin.kind === "local" || item.source.default_ref));
    if (existing) return code_power_view(await this.code.call("extension.add", { source: source_input, ref, cwd: process.cwd(), operation_id }) as ExtensionResult);
    return await with_power_source(source_input, ref, async (source) => {
      const package_manifest = await fs.pathExists(`${source.directory}/power.json`);
      const code_entry = await fs.pathExists(`${source.directory}/downcity.ts`) || await fs.pathExists(`${source.directory}/downcity.js`);
      if (package_manifest && code_entry) throw new Error("Power source is ambiguous: provide either power.json or downcity.ts/downcity.js at its root");
      if (package_manifest) {
        const installed = await install_prepared_power(source, this.root_path);
        return { power_id: installed.id, kind: "package", title: installed.title || installed.id, description: installed.description, source: installed.source, status: "installed", package: installed };
      }
      if (!code_entry) throw new Error("Power source must contain power.json or downcity.ts/downcity.js");
      return code_power_view(await this.code.call("extension.add", { source: source_input, ref, cwd: process.cwd(), operation_id }) as ExtensionResult);
    });
  }

  /** 更新与重载都从保存来源重新准备，代码状态由实际宿主投影。 */
  async refresh(power_id: string, operation_id?: string): Promise<ManagedPower> {
    const item = await this.resolve(power_id);
    if (item.kind === "builtin") throw new Error("Builtin Powers are updated with City");
    if (item.kind === "code") return code_power_view(await this.code.call("extension.reload", { extension_id: power_id, operation_id }) as ExtensionResult);
    await update_power(power_id, this.root_path);
    return await this.resolve(power_id);
  }

  /** 卸载严格使用同一管理身份；代码保留来源身份、配置和 data。 */
  async uninstall(power_id: string, operation_id?: string): Promise<ManagedPower> {
    const item = await this.resolve(power_id);
    if (item.kind === "builtin") throw new Error("Builtin Powers cannot be uninstalled");
    if (item.kind === "code") return code_power_view(await this.code.call("extension.remove", { extension_id: power_id, operation_id }) as ExtensionResult);
    const lease = RootLease.acquire_write(this.root_path);
    try { this.repository.remove_installed(power_id); }
    finally { lease.release(); }
    return { ...item, status: "removed" };
  }

  /** Inspect 校验制品，不执行入口；代码项附上其当前可调用入口。 */
  async inspect(power_id: string) {
    const item = await this.resolve(power_id);
    if (item.package) await verify_local_installed_power_integrity(this.repository.power_path(power_id), item.package);
    const entries = item.kind === "code" ? (await this.entries()).filter((entry) => entry.extension_id === power_id).map((entry) => ({ entry_id: entry.power_id, title: entry.title, description: entry.description, generation: entry.generation })) : [];
    return { ...item, ...(item.kind === "code" ? { entries } : {}) };
  }

  /** 配置查询只暴露字段及应用状态；读取到的值仅供配置编辑内部使用。 */
  async configuration(power_id: string): Promise<ExtensionConfigurationView> {
    const item = await this.resolve(power_id);
    if (item.kind === "code") return await this.code.call("extension.configuration", { extension_id: power_id }) as ExtensionConfigurationView;
    const config = await this.package_configuration(power_id);
    return { config, fields: [], configured_secrets: [], staged_version: "current", applied_version: "current" };
  }

  /** 统一配置保存；代码秘密仍走原私密存储和配置版本机制。 */
  async configure(power_id: string, configuration: Record<string, unknown>, secrets: Record<string, string> = {}, operation_id?: string): Promise<unknown> {
    const item = await this.resolve(power_id);
    if (item.kind === "code") return code_power_view(await this.code.call("extension.configure", { extension_id: power_id, configuration, secrets, operation_id }) as ExtensionResult);
    if (Object.keys(secrets).length) throw new Error("--secrets-stdin requires a Power with requested private fields");
    await this.package_configuration(power_id, configuration as JsonObject);
    return { power_id, configured: Object.keys(configuration).length > 0, fields: Object.keys(configuration).sort() };
  }

  /** Action 通过管理身份选择其运行入口；多入口必须显式选择。 */
  async action_target(power_id: string, entry_id?: string): Promise<string> {
    const items = await this.list();
    const item = items.find((candidate) => candidate.power_id === power_id);
    if (item && item.kind !== "code") {
      if (/^ext_[a-f\d]{32}_power_[a-f\d]{16}$/u.test(power_id) && (await this.entries()).some((entry) => entry.power_id === power_id)) throw new Error(`Power ID conflicts with a code runtime entry: ${power_id}`);
      if (entry_id) throw new Error("--entry is only used for a Power with multiple runtime entries");
      return item.power_id;
    }
    const entries = await this.entries();
    // 运行入口 ID 仍可直接调用，但管理操作始终使用其所属 Power ID。
    if (!item && !entry_id && entries.some((entry) => entry.power_id === power_id)) return power_id;
    if (!item) throw new Error(`Power not found: ${power_id}`);
    const candidates = entries.filter((entry) => entry.extension_id === power_id && (!entry_id || entry.power_id === entry_id));
    if (candidates.length !== 1) throw new Error(candidates.length ? "Power has multiple runtime entries; choose --entry from power inspect" : "Power has no matching active runtime entry; inspect its status");
    return candidates[0]!.power_id;
  }

  /**
   * 单包 TOML 不依赖 Workspace 数据库 schema。在线交给宿主协调，离线持有根租约后
   * 直接使用相同配置仓储，避免仅登记过代码来源的数据根被误判为需要启动 City。
   */
  private async package_configuration(power_id: string, config?: JsonObject): Promise<JsonObject> {
    const client = await LocalHostClient.connect({ root_path: this.root_path });
    if (client) {
      try { return await client.call(config === undefined ? "config.power.get" : "config.power.set", { power_id, ...(config !== undefined ? { config } : {}) }) as JsonObject; }
      finally { await client.close(); }
    }
    const lease = config === undefined ? RootLease.acquire_read(this.root_path) : RootLease.acquire_write(this.root_path);
    try {
      if (await read_city_host_state(this.root_path)) throw new ResourceError("host_unreachable", "City became active; retry through its management channel", 5, true);
      if (!this.repository.get_installed(power_id) && !create_cli_builtin_power_registrations().some(({ power }) => power.name === power_id)) throw new Error(`Power not found: ${power_id}`);
      return config === undefined ? this.repository.get_config(power_id) : this.repository.set_config(power_id, config);
    } finally { lease.release(); }
  }

  /** 只返回宿主已经发布的运行入口；离线不执行代码来探测能力。 */
  private async entries(): Promise<ExtensionPowerView[]> { return await this.code.call("extension.powers") as ExtensionPowerView[]; }
}
