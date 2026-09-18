/**
 * Desktop Power catalog、配置界面与 Renderer runtime 控制器。
 *
 * City 持有每个 Power 的唯一配置与生命周期；业务工作区和设置中心分别调用
 * 独立的 action gateway。
 */

import fs from "node:fs";
import type { PowerJsonValue, PowerSnapshot } from "@downcity/city/power";
import {
  verify_local_installed_power_integrity,
  type LocalPowerDefinition,
} from "@downcity/city/local";
import type {
  DesktopInvokePowerActionInput,
  DesktopPowerDefinition,
  DesktopPowerSummary,
} from "../../common/types/DesktopApi.js";
import { create_desktop_builtin_power_registrations } from "../agent/DesktopAgentAssembly.js";
import type { DesktopLocalData } from "../agent/DesktopLocalData.js";
import type { ResolvedDesktopPower } from "../types/power/PowerController.js";
import {
  create_installed_power_icon_url,
  create_installed_power_renderer_url,
} from "./PowerRendererProtocol.js";

/** 管理 Desktop 当前可见的 Power、Config 和 Mainview。 */
export class PowerController {
  constructor(
    private readonly data: DesktopLocalData,
    private readonly invoke_host_action: (
      power_id: string,
      action_id: string,
      input?: PowerJsonValue,
    ) => Promise<PowerJsonValue>,
    private readonly invoke_config: (
      power_id: string,
      action_id: string,
      input?: PowerJsonValue,
    ) => Promise<PowerJsonValue>,
    private readonly list_runtime_states: () => readonly PowerSnapshot[],
  ) {}

  /** 列出统一 Power catalog。 */
  async list(): Promise<DesktopPowerSummary[]> {
    const builtin = create_desktop_builtin_power_registrations(this.data)
      .map((registration): ResolvedDesktopPower => ({
        definition: to_builtin_definition(registration),
        source: "builtin",
        registration,
      }));
    const installed = await Promise.all(this.data.powers.list_installed().map(async (item) => {
      await verify_local_installed_power_integrity(
        this.data.powers.power_path(item.id),
        item,
      );
      return {
        definition: to_installed_definition(item),
        source: "installed" as const,
        installed: item,
      };
    }));
    return [...builtin, ...installed]
      .map((power) => this.create_summary(power))
      .sort((left, right) => left.title.localeCompare(right.title));
  }

  /** 读取 Power 定义和可选第三方 Renderer URL。 */
  async get(power_id: string): Promise<DesktopPowerDefinition> {
    const power = await this.resolve_power(power_id);
    const renderer_url = power.installed
      ? create_installed_power_renderer_url(power.installed)
      : undefined;
    const readme = power.installed
      ? this.data.powers.read_installed_readme(
        power.installed.id,
        power.installed.readme,
      )
      : fs.readFileSync(power.definition.readme, "utf8");
    return {
      ...this.create_summary(power),
      ...(readme?.trim() ? { readme } : {}),
      ...(renderer_url ? { renderer_url } : {}),
    };
  }

  /** 按业务工作区或 Config 范围调用 Power 宿主管理 action。 */
  async invoke(power_id: string, input: DesktopInvokePowerActionInput) {
    if (input.surface === "mainview") {
      return await this.invoke_host_action(
        power_id,
        input.action_id,
        input.input,
      );
    }
    return await this.invoke_config(
      power_id,
      input.action_id,
      input.input,
    );
  }

  /** 解析内置或第三方 Power，不执行运行入口。 */
  private async resolve_power(power_id: string): Promise<ResolvedDesktopPower> {
    const registration = create_desktop_builtin_power_registrations(this.data)
      .find((item) => item.power.name === power_id);
    if (registration) {
      return { definition: to_builtin_definition(registration), source: "builtin", registration };
    }
    const installed = this.data.powers.get_installed(power_id);
    if (!installed) throw new Error(`Power not found: ${power_id}`);
    await verify_local_installed_power_integrity(
      this.data.powers.power_path(power_id),
      installed,
    );
    return {
      definition: to_installed_definition(installed),
      source: "installed",
      installed,
    };
  }

  /** 从静态定义与 City 运行状态创建 Renderer catalog 摘要。 */
  private create_summary(power: ResolvedDesktopPower): DesktopPowerSummary {
    const icon_url = power.installed
      ? create_installed_power_icon_url(power.installed)
      : undefined;
    const runtime_state = this.list_runtime_states()
      .find((snapshot) => snapshot.name === power.definition.id);
    return {
      power_id: power.definition.id,
      title: power.definition.title || power.definition.id,
      description: power.definition.description || "",
      ...(power.installed ? { version: power.installed.version } : {}),
      ...(icon_url ? { icon_url } : {}),
      source: power.source,
      has_main: power.definition.has_main,
      has_sidebar: power.definition.has_sidebar,
      has_mainview: power.definition.has_mainview,
      has_config: power.definition.has_config,
      ...(runtime_state
        ? {
            runtime_status: runtime_state.status,
            ...(runtime_state.last_error
              ? { runtime_error: runtime_state.last_error }
              : {}),
          }
        : power.definition.has_main
          ? {
              runtime_status: "error" as const,
              runtime_error: `Power runtime is not registered: ${power.definition.id}`,
            }
          : {}),
    };
  }
}

/** 把内建 City 注册投影为 Desktop catalog 定义。 */
function to_builtin_definition(
  registration: NonNullable<ResolvedDesktopPower["registration"]>,
): LocalPowerDefinition {
  return {
    id: registration.power.name,
    title: registration.power.title || registration.power.name,
    description: registration.power.description,
    readme: registration.readme,
    has_main: true,
    has_sidebar: registration.has_sidebar,
    has_mainview: registration.has_mainview,
    has_config: registration.has_config,
  };
}

/** 把第三方安装清单投影为统一静态定义。 */
function to_installed_definition(
  installed: NonNullable<ResolvedDesktopPower["installed"]>,
): LocalPowerDefinition {
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
