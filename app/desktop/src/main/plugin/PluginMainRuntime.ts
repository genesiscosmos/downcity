/**
 * Desktop Plugin main 生命周期与 action 调度器。
 *
 * 每个 Plugin main 在 Desktop 进程中只激活一次。Profile 不是 main 实例的一部分；
 * action 调用时才创建绑定当前 Plugin/Profile 的配置存储，从而支持多个 Profile 并发使用。
 */

import { clipboard, shell } from "electron";
import path from "node:path";
import type {
  PluginJsonObject,
  PluginJsonValue,
  PluginMainAction,
  PluginMainContext,
  PluginMainModule,
} from "@downcity/plugin";
import type { DesktopLocalData } from "../agent/DesktopLocalData.js";
import type { PluginMainRuntimeOptions } from "../types/plugin/PluginMainRuntime.js";

/** 一个已经激活的 Plugin main。 */
interface ActivePluginMain {
  /** Plugin main 生命周期对象。 */
  readonly module: PluginMainModule;

  /** 激活时注入并在关闭时复用的稳定上下文。 */
  readonly context: PluginMainContext;

  /** 按稳定 ID 注册的全部 action。 */
  readonly actions: Map<string, PluginMainAction>;
}

/** 管理全部 Desktop Plugin main。 */
export class PluginMainRuntime {
  /** 已激活 Plugin 的唯一运行记录。 */
  private readonly active_plugins = new Map<string, ActivePluginMain>();

  constructor(
    private readonly data: DesktopLocalData,
    private readonly options: PluginMainRuntimeOptions,
  ) {}

  /** 在指定 Profile 范围内调用一个 Plugin main action。 */
  async invoke(
    plugin_id_input: string,
    profile_id_input: string,
    action_id_input: string,
    input?: PluginJsonValue,
  ): Promise<PluginJsonValue> {
    const plugin_id = normalize_required_id(plugin_id_input, "plugin_id");
    const profile_id = normalize_required_id(profile_id_input, "profile_id");
    const action_id = normalize_required_id(action_id_input, "action_id");
    if (!this.data.plugins.get_profile(plugin_id, profile_id)) {
      throw new Error(`Plugin Profile not found: ${plugin_id}/${profile_id}`);
    }
    const runtime = await this.require_active(plugin_id);
    const action = runtime.actions.get(action_id);
    if (!action) throw new Error(`Plugin main action not found: ${plugin_id}/${action_id}`);
    const result = await action.run(input, {
      config: {
        get: async () => structuredClone(
          this.data.plugins.get_profile(plugin_id, profile_id) ?? {},
        ) as PluginJsonObject,
        set: async (config) => {
          this.data.plugins.save_profile(
            plugin_id,
            profile_id,
            structuredClone(config),
          );
        },
      },
    });
    return normalize_json_value(result, `${plugin_id}/${action_id} result`);
  }

  /** 停止全部已经激活的 Plugin main，并继续收口其他实例。 */
  async dispose(): Promise<void> {
    const failures: Error[] = [];
    for (const [plugin_id, runtime] of [...this.active_plugins].reverse()) {
      try {
        await runtime.module.deactivate?.(runtime.context);
      } catch (reason) {
        failures.push(to_error(reason, `Plugin main deactivate failed: ${plugin_id}`));
      }
    }
    this.active_plugins.clear();
    if (failures.length > 0) throw new AggregateError(failures, "Plugin main shutdown failed");
  }

  /** 返回一个已激活实例，首次调用时完成加载与 activate。 */
  private async require_active(plugin_id: string): Promise<ActivePluginMain> {
    const current = this.active_plugins.get(plugin_id);
    if (current) return current;
    const resolved = await this.options.resolve_main(plugin_id);
    if (!resolved) throw new Error(`Plugin does not provide main capability: ${plugin_id}`);
    const actions = new Map<string, PluginMainAction>();
    const context = create_main_context(plugin_id, actions);
    const runtime = { module: resolved.module, context, actions };
    // 关键点（中文）：activate 成功后才发布运行记录，失败实例不能被后续调用复用。
    await resolved.module.activate(context);
    this.active_plugins.set(plugin_id, runtime);
    return runtime;
  }
}

/** 创建一个只能操作当前 Plugin 的 main 上下文。 */
function create_main_context(
  plugin_id: string,
  actions: Map<string, PluginMainAction>,
): PluginMainContext {
  const log = (level: "debug" | "info" | "warn" | "error", message: string, data?: PluginJsonObject) => {
    const record = data ? [message, data] : [message];
    console[level](`[Plugin:${plugin_id}]`, ...record);
  };
  return {
    plugin: {
      id: plugin_id,
      action(action) {
        const action_id = normalize_required_id(action.id, "action.id");
        if (actions.has(action_id)) {
          throw new Error(`Plugin main action is already registered: ${plugin_id}/${action_id}`);
        }
        actions.set(action_id, { ...action, id: action_id });
      },
    },
    logger: {
      debug: (message, data) => log("debug", message, data),
      info: (message, data) => log("info", message, data),
      warn: (message, data) => log("warn", message, data),
      error: (message, data) => log("error", message, data),
    },
    system: {
      async open_external({ url: value }) {
        const url = new URL(value);
        if (url.protocol !== "http:" && url.protocol !== "https:") {
          throw new Error(`Plugin external URL protocol is not supported: ${url.protocol}`);
        }
        await shell.openExternal(url.toString());
      },
      async show_item_in_folder({ path: file_path }) {
        if (!path.isAbsolute(file_path)) {
          throw new Error("Plugin show_item_in_folder requires an absolute path");
        }
        shell.showItemInFolder(file_path);
      },
      async write_clipboard_text({ text }) {
        clipboard.writeText(String(text));
      },
    },
  };
}

/** 要求一个协议 ID 是非空字符串。 */
function normalize_required_id(value: string, label: string): string {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

/** 通过 JSON round-trip 拒绝 action 边界中的函数、循环引用和非 JSON 值。 */
function normalize_json_value(value: PluginJsonValue, label: string): PluginJsonValue {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error(`${label} is not JSON-serializable`);
    return JSON.parse(serialized) as PluginJsonValue;
  } catch (reason) {
    throw to_error(reason, `${label} is not JSON-serializable`);
  }
}

/** 把未知失败收敛成带稳定上下文的 Error。 */
function to_error(reason: unknown, message: string): Error {
  return reason instanceof Error ? new Error(message, { cause: reason }) : new Error(`${message}: ${String(reason)}`);
}
