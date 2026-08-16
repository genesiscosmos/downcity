/**
 * Plugin 点注册表。
 *
 * 关键点（中文）
 * - 统一管理 pipeline / guard / effect / resolve 四类 plugin 点。
 * - service 只依赖固定执行语义，不再自己拼装扩展调度逻辑。
 */

import type { JsonValue } from "@/types/common/Json.js";
import type {
  PluginEffectHook,
  PluginGuardHook,
  PluginPipelineHook,
  PluginResolveHook,
} from "@/types/plugin/PluginRuntime.js";
import type { PluginContext } from "@/types/plugin/PluginContext.js";

type PipelineRecord = {
  plugin_name: string;
  handler: PluginPipelineHook<JsonValue>;
};

type GuardRecord = {
  plugin_name: string;
  handler: PluginGuardHook<JsonValue>;
};

type EffectRecord = {
  plugin_name: string;
  handler: PluginEffectHook<JsonValue>;
};

type ResolveRecord = {
  plugin_name: string;
  handler: PluginResolveHook<JsonValue, JsonValue>;
};

/**
 * HookRegistry：plugin 点注册与执行实现。
 */
export class HookRegistry {
  private readonly is_plugin_ready: (plugin_name: string) => boolean;

  private readonly pipelineHooks = new Map<string, PipelineRecord[]>();

  private readonly guardHooks = new Map<string, GuardRecord[]>();

  private readonly effectHooks = new Map<string, EffectRecord[]>();

  private readonly resolveHooks = new Map<string, ResolveRecord>();

  constructor(params: {
    is_plugin_ready: (plugin_name: string) => boolean;
  }) {
    this.is_plugin_ready = params.is_plugin_ready;
  }

  /**
   * 注册 pipeline 扩展点。
   */
  pipeline(
    point_name: string,
    plugin_name: string,
    handler: PluginPipelineHook<JsonValue>,
  ): void {
    const key = String(point_name || "").trim();
    if (!key) {
      throw new Error("Pipeline point name is required");
    }
    const bucket = this.pipelineHooks.get(key) || [];
    bucket.push({
      plugin_name: String(plugin_name || "").trim(),
      handler,
    });
    this.pipelineHooks.set(key, bucket);
  }

  /**
   * 注册 guard 扩展点。
   */
  guard(
    point_name: string,
    plugin_name: string,
    handler: PluginGuardHook<JsonValue>,
  ): void {
    const key = String(point_name || "").trim();
    if (!key) {
      throw new Error("Guard point name is required");
    }
    const bucket = this.guardHooks.get(key) || [];
    bucket.push({
      plugin_name: String(plugin_name || "").trim(),
      handler,
    });
    this.guardHooks.set(key, bucket);
  }

  /**
   * 注册 effect 扩展点。
   */
  effect(
    point_name: string,
    plugin_name: string,
    handler: PluginEffectHook<JsonValue>,
  ): void {
    const key = String(point_name || "").trim();
    if (!key) {
      throw new Error("Effect point name is required");
    }
    const bucket = this.effectHooks.get(key) || [];
    bucket.push({
      plugin_name: String(plugin_name || "").trim(),
      handler,
    });
    this.effectHooks.set(key, bucket);
  }

  /**
   * 注册 resolve 扩展点。
   *
   * 关键点（中文）
   * - resolve 语义要求单点单处理器，避免 service 侧再做二次仲裁。
   */
  resolve(
    point_name: string,
    plugin_name: string,
    handler: PluginResolveHook<JsonValue, JsonValue>,
  ): void {
    const key = String(point_name || "").trim();
    if (!key) {
      throw new Error("Resolve point name is required");
    }
    if (this.resolveHooks.has(key)) {
      throw new Error(`Resolve point already registered: ${key}`);
    }
    this.resolveHooks.set(key, {
      plugin_name: String(plugin_name || "").trim(),
      handler,
    });
  }

  /**
   * 移除指定 plugin 注册的全部扩展点。
   */
  unregister_plugin(plugin_name: string): void {
    const key = String(plugin_name || "").trim();
    if (!key) return;

    for (const [point_name, bucket] of this.pipelineHooks.entries()) {
      const next = bucket.filter((item) => item.plugin_name !== key);
      if (next.length > 0) {
        this.pipelineHooks.set(point_name, next);
      } else {
        this.pipelineHooks.delete(point_name);
      }
    }

    for (const [point_name, bucket] of this.guardHooks.entries()) {
      const next = bucket.filter((item) => item.plugin_name !== key);
      if (next.length > 0) {
        this.guardHooks.set(point_name, next);
      } else {
        this.guardHooks.delete(point_name);
      }
    }

    for (const [point_name, bucket] of this.effectHooks.entries()) {
      const next = bucket.filter((item) => item.plugin_name !== key);
      if (next.length > 0) {
        this.effectHooks.set(point_name, next);
      } else {
        this.effectHooks.delete(point_name);
      }
    }

    for (const [point_name, record] of this.resolveHooks.entries()) {
      if (record.plugin_name === key) {
        this.resolveHooks.delete(point_name);
      }
    }
  }

  /**
   * 列出所有已注册扩展点。
   */
  list(): string[] {
    const keys = new Set<string>([
      ...this.pipelineHooks.keys(),
      ...this.guardHooks.keys(),
      ...this.effectHooks.keys(),
      ...this.resolveHooks.keys(),
    ]);
    return Array.from(keys).sort((a, b) => a.localeCompare(b));
  }

  /**
   * 运行 pipeline 扩展点。
   */
  async pipelineValue<T = JsonValue>(
    context: PluginContext,
    point_name: string,
    value: T,
  ): Promise<T> {
    const key = String(point_name || "").trim();
    if (!key) return value;
    const bucket = this.pipelineHooks.get(key) || [];
    if (bucket.length === 0) return value;

    let current = value as JsonValue;
    for (const item of bucket) {
      if (!this.is_plugin_ready(item.plugin_name)) continue;
      current = await item.handler({
        context,
        value: current,
        plugin: item.plugin_name,
      });
    }
    return current as T;
  }

  /**
   * 运行 guard 扩展点。
   */
  async guardValue<T = JsonValue>(
    context: PluginContext,
    point_name: string,
    value: T,
  ): Promise<void> {
    const key = String(point_name || "").trim();
    if (!key) return;
    const bucket = this.guardHooks.get(key) || [];
    if (bucket.length === 0) return;

    for (const item of bucket) {
      if (!this.is_plugin_ready(item.plugin_name)) continue;
      await item.handler({
        context,
        value: value as JsonValue,
        plugin: item.plugin_name,
      });
    }
  }

  /**
   * 运行 effect 扩展点。
   */
  async effectValue<T = JsonValue>(
    context: PluginContext,
    point_name: string,
    value: T,
  ): Promise<void> {
    const key = String(point_name || "").trim();
    if (!key) return;
    const bucket = this.effectHooks.get(key) || [];
    if (bucket.length === 0) return;

    for (const item of bucket) {
      if (!this.is_plugin_ready(item.plugin_name)) continue;
      await item.handler({
        context,
        value: value as JsonValue,
        plugin: item.plugin_name,
      });
    }
  }

  /**
   * 运行 resolve 点。
   */
  async resolveValue<TInput = JsonValue, TOutput = JsonValue>(
    context: PluginContext,
    point_name: string,
    value: TInput,
  ): Promise<TOutput> {
    const key = String(point_name || "").trim();
    if (!key) {
      throw new Error("Resolve point name is required");
    }
    const record = this.resolveHooks.get(key);
    if (!record) {
      throw new Error(`No plugin resolver registered for point: ${key}`);
    }
    if (!this.is_plugin_ready(record.plugin_name)) {
      throw new Error(`No active plugin resolver registered for point: ${key}`);
    }

    return await record.handler({
      context,
      value: value as JsonValue,
      plugin: record.plugin_name,
    }) as TOutput;
  }
}
