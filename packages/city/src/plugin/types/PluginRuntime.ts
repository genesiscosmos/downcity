/**
 * City Plugin Action、Hook、生命周期与观察协议。
 *
 * 本模块不依赖 Agent 内核；City 通过受限上下文把领域对象投影给 Plugin。
 */

import type { Command } from "commander";
import type { Hono } from "hono";
import type { Context as HonoContext } from "hono";
import type { z } from "zod";
import type { AuthRoutePolicy } from "@downcity/type";
import type { PluginContext, PluginLogger, PluginProfile, PluginStorage } from "./PluginContext.js";
import type { PluginJsonObject, PluginJsonValue } from "./Json.js";
import type { PluginMainContext, PluginMainModule } from "./PluginMain.js";

/** Action 可以追加到 Session 的一条消息。 */
export type PluginActionMessage =
  | {
      /** User 内容在下一 Step 生效。 */
      readonly role: "user";
      /** User 消息内容。 */
      readonly parts: Array<
        | { readonly type: "text"; readonly text: string }
        | { readonly type: "context"; readonly tag: string; readonly context: string }
        | { readonly type: "file"; readonly media_type: string; readonly url: string; readonly filename?: string }
        | { readonly type: "data"; readonly data_type: string; readonly data: PluginJsonValue; readonly data_id?: string }
      >;
    }
  | {
      /** Assistant 内容写入当前回复。 */
      readonly role: "assistant";
      /** Assistant 消息内容。 */
      readonly parts: Array<
        | { readonly type: "text"; readonly text: string }
        | { readonly type: "file"; readonly media_type: string; readonly url: string; readonly filename?: string }
        | { readonly type: "data"; readonly data_type: string; readonly data: PluginJsonValue; readonly data_id?: string }
      >;
    };

/** Plugin Action 执行结果。 */
export interface PluginActionResult<TResult extends PluginJsonValue = PluginJsonValue> {
  /** Action 是否成功。 */
  readonly success: boolean;
  /** 可序列化结果数据。 */
  readonly data?: TResult;
  /** 失败时的稳定错误文本。 */
  readonly error?: string;
  /** 面向人类的结果摘要。 */
  readonly message?: string;
  /** Action 执行后写入 Session 的消息。 */
  readonly messages?: PluginActionMessage[];
}

/** 当前调用所属的 Session 执行身份。 */
export interface PluginSessionExecutionScope {
  /** Session 稳定标识。 */
  readonly session_id: string;
  /** Session 来源。 */
  readonly origin: { readonly type: string; readonly [key: string]: PluginJsonValue };
  /** Turn 稳定标识。 */
  readonly turn_id: string;
}

/** Plugin 可读取的当前 Step 快照。 */
export interface PluginExecutionContext {
  /** 当前 Session 标识。 */
  readonly session_id?: string;
  /** 当前 Session 来源。 */
  readonly session_origin?: { readonly type: string; readonly [key: string]: PluginJsonValue };
  /** 当前 Turn 标识。 */
  readonly turn_id?: string;
  /** 当前 Workspace 根目录。 */
  readonly project_root?: string;
  /** 当前 Step 的 Workspace 环境快照。 */
  readonly workspace_env?: Readonly<Record<string, string>>;
  /** 当前 Step 的 Agent 指令快照。 */
  readonly agent_systems?: readonly string[];
  /** 当前 Turn 的取消信号。 */
  readonly abort_signal?: AbortSignal;
  /** 当前 Action 调用标识。 */
  readonly call_id?: string;
}

/** Plugin Action 的单次执行上下文。 */
export interface PluginActionExecutionContext {
  /** 当前 Action 调用标识。 */
  readonly call_id: string;
  /** 当前 Action 必须监听的取消信号。 */
  readonly abort_signal: AbortSignal;
  /** 当前调用所属 Session；非 Session 入口时为空。 */
  readonly session?: PluginSessionExecutionScope;
  /** 当前调用开始时捕获的只读 Step 快照。 */
  readonly snapshot: PluginExecutionContext;
}

/** Plugin Action 命令输入。 */
export interface PluginActionCommandInput {
  /** 位置参数。 */
  readonly args: string[];
  /** Commander 解析后的选项。 */
  readonly opts: Record<string, PluginJsonValue>;
}

/** Plugin Action 的 CLI 适配声明。 */
export interface PluginActionCommand<TInput extends PluginJsonValue = PluginJsonValue> {
  /** 命令用途说明。 */
  readonly description: string;
  /** 配置 Commander 子命令。 */
  readonly configure?: (command: Command) => void;
  /** 把 CLI 输入映射为 Action payload。 */
  readonly map_input: (input: PluginActionCommandInput) => TInput | Promise<TInput>;
}

/** Plugin Action 的 HTTP 适配声明。 */
export interface PluginActionApi<TInput extends PluginJsonValue = PluginJsonValue> {
  /** HTTP 方法。 */
  readonly method?: "GET" | "POST" | "PUT" | "DELETE";
  /** 相对 Plugin HTTP 根的路径。 */
  readonly path?: string;
  /** 把 HTTP 请求映射为 Action payload。 */
  readonly map_input?: (context: HonoContext) => TInput | Promise<TInput>;
}

/** Plugin Action 调用示例。 */
export interface PluginActionExample<TInput extends PluginJsonValue = PluginJsonValue> {
  /** 示例标题。 */
  readonly title: string;
  /** 示例补充说明。 */
  readonly description?: string;
  /** 示例 payload。 */
  readonly payload: TInput;
}

/** Plugin Action 输入校验与展示 schema。 */
export interface PluginActionInputSchema<TInput extends PluginJsonValue = PluginJsonValue> {
  /** 运行时 Zod 校验器。 */
  readonly zod?: z.ZodTypeAny;
  /** 面向模型与 UI 的 JSON Schema。 */
  readonly json_schema?: PluginJsonObject;
}

/** 单个 Plugin Action。 */
export interface PluginAction<TInput extends PluginJsonValue = PluginJsonValue, TResult extends PluginJsonValue = PluginJsonValue> {
  /** Action 用途说明。 */
  readonly description?: string;
  /** Action 输入 schema。 */
  readonly input_schema?: PluginActionInputSchema<TInput>;
  /** Action 示例。 */
  readonly examples?: PluginActionExample<TInput>[];
  /** Action 协作式超时上限。 */
  readonly timeout_ms?: number;
  /** 可选 CLI 适配。 */
  readonly command?: PluginActionCommand<TInput>;
  /** 可选 HTTP 适配。 */
  readonly api?: PluginActionApi<TInput>;
  /** 执行 Action。 */
  readonly execute: (input: {
    /** City 创建的动态 Plugin 上下文。 */
    readonly context: PluginContext;
    /** 单次 Action 执行身份。 */
    readonly execution: PluginActionExecutionContext;
    /** 已校验的 Action payload。 */
    readonly input: TInput;
    /** 当前 Plugin ID。 */
    readonly plugin_name: string;
    /** 当前 Action ID。 */
    readonly action_name: string;
  }) => PluginActionResult<TResult> | Promise<PluginActionResult<TResult>>;
}

/** Plugin Action 集合。 */
export type PluginActions = Record<string, PluginAction<PluginJsonValue, PluginJsonValue>>;

/** Plugin pipeline 处理器。 */
export type PluginPipelineHook<TValue extends PluginJsonValue = PluginJsonValue> = (input: {
  /** 动态 Plugin 上下文。 */ readonly context: PluginContext;
  /** 当前管线值。 */ readonly value: TValue;
  /** 当前 Plugin ID。 */ readonly plugin: string;
}) => TValue | Promise<TValue>;

/** Plugin guard 处理器。 */
export type PluginGuardHook<TValue extends PluginJsonValue = PluginJsonValue> = (input: {
  /** 动态 Plugin 上下文。 */ readonly context: PluginContext;
  /** 当前校验值。 */ readonly value: TValue;
  /** 当前 Plugin ID。 */ readonly plugin: string;
}) => void | Promise<void>;

/** Plugin effect 处理器。 */
export type PluginEffectHook<TValue extends PluginJsonValue = PluginJsonValue> = (input: {
  /** 动态 Plugin 上下文。 */ readonly context: PluginContext;
  /** 当前事件值。 */ readonly value: TValue;
  /** 当前 Plugin ID。 */ readonly plugin: string;
}) => void | Promise<void>;

/** Plugin resolve 处理器。 */
export type PluginResolveHook<TInput extends PluginJsonValue = PluginJsonValue, TResult extends PluginJsonValue = PluginJsonValue> = (input: {
  /** 动态 Plugin 上下文。 */ readonly context: PluginContext;
  /** 当前解析输入。 */ readonly value: TInput;
  /** 当前 Plugin ID。 */ readonly plugin: string;
}) => TResult | Promise<TResult>;

/** Plugin Hook 集合。 */
export interface PluginHooks {
  /** Pipeline 点映射。 */ readonly pipeline?: Record<string, PluginPipelineHook[]>;
  /** Guard 点映射。 */ readonly guard?: Record<string, PluginGuardHook[]>;
  /** Effect 点映射。 */ readonly effect?: Record<string, PluginEffectHook[]>;
}

/** Plugin Resolve 点集合。 */
export type PluginResolves = Record<string, PluginResolveHook>;

/** Plugin 当前可用性。 */
export interface PluginAvailability {
  /** 当前 Agent 是否绑定此 Plugin。 */ readonly enabled: boolean;
  /** 当前环境是否满足执行要求。 */ readonly available: boolean;
  /** 不可用原因。 */ readonly reasons: string[];
}

/** Plugin 生命周期上下文。 */
export interface PluginLifecycleContext {
  /** 当前 Plugin ID。 */ readonly plugin_id: string;
  /** 当前 Agent 绑定的 Profile。 */ readonly profile: PluginProfile;
  /** 当前 Plugin/Profile 私有存储。 */ readonly storage: PluginStorage;
  /** Plugin 独享日志端口。 */ readonly logger: PluginLogger;
}

/** Plugin 生命周期。 */
export interface PluginLifecycle {
  /** 当前 City 共享实例进入 ready 前启动 Profile 级长期资源。 */ readonly start?: (context: PluginLifecycleContext) => void | Promise<void>;
  /** Agent 进入 Workspace 时绑定一个可直接通信的执行作用域。 */ readonly bind?: (context: PluginContext) => void | Promise<void>;
  /** Agent 离开 Workspace 或解绑 Plugin 时释放该执行作用域。 */ readonly unbind?: (context: PluginContext) => void | Promise<void>;
  /** 最后一个 execution lease 释放后停止长期资源。 */ readonly stop?: (context: PluginLifecycleContext) => void | Promise<void>;
}

/** Plugin 向 City HTTP transport 声明的一组路由。 */
export interface PluginHttpRegistration {
  /** 当前路由组要求的鉴权策略。 */
  readonly auth_policies?: AuthRoutePolicy[];
  /** 把路由注册到 City 提供的隔离应用。 */
  readonly register: (input: {
    /** 当前路由组使用的 Hono 应用。 */
    readonly app: Hono;
    /** 动态读取当前请求对应的 Plugin 上下文。 */
    readonly get_context: () => PluginContext;
    /** 当前 Plugin 稳定 ID。 */
    readonly plugin_name: string;
  }) => void;
}

/** Plugin 的 HTTP transport 扩展声明。 */
export interface PluginHttpDefinition {
  /** City Server 可挂载的路由。 */
  readonly server?: PluginHttpRegistration;
}

/** City 中一个 Plugin 的 Agent 执行模块。 */
export interface Plugin {
  /** Plugin 稳定 ID。 */ readonly name: string;
  /** Plugin 用户可见标题。 */ readonly title: string;
  /** Plugin 用途说明。 */ readonly description: string;
  /** Plugin Action 集合。 */ readonly actions?: PluginActions;
  /** Plugin Hook 集合。 */ readonly hooks?: PluginHooks;
  /** Plugin Resolve 点集合。 */ readonly resolves?: PluginResolves;
  /** 构建当前执行范围的 system 文本。 */
  readonly system?: (context: PluginContext, execution_context?: PluginExecutionContext) => string | Promise<string>;
  /** Plugin 生命周期。 */ readonly lifecycle?: PluginLifecycle;
  /** 检查当前动态上下文的可用性。 */
  readonly availability?: (context: PluginContext) => PluginAvailability | Promise<PluginAvailability>;
  /** Plugin 的可选 HTTP 路由声明。 */
  readonly http?: PluginHttpDefinition;
}

/** City 创建 Plugin 执行模块时提供的宿主上下文。 */
export interface PluginFactoryContext extends PluginLifecycleContext {
  /** City 读取并校验后的 Profile 配置。 */ readonly profile: PluginProfile;
}

/** 统一第三方 `main` 入口默认导出的模块。 */
export interface CityPluginModule extends PluginMainModule {
  /** 为一个 City Profile 创建执行模块；实例与生命周期由 City 持有。 */
  readonly create: (context: PluginFactoryContext) => Plugin | Promise<Plugin>;
}

/** City 可注册的 Plugin 静态定义与入口。 */
export interface CityPluginRegistration {
  /** Plugin 稳定 ID。 */ readonly id: string;
  /** Plugin 用户可见标题。 */ readonly title: string;
  /** Plugin 用途说明。 */ readonly description: string;
  /** 用户文档绝对路径。 */ readonly readme: string;
  /** 是否提供设置界面。 */ readonly has_config: boolean;
  /** 是否提供 Sidebar。 */ readonly has_sidebar: boolean;
  /** 是否提供 Mainview。 */ readonly has_mainview: boolean;
  /** 统一生命周期与执行入口。 */ readonly module: CityPluginModule;
}

/** Plugin 当前运行状态。 */
export type PluginState = "initializing" | "ready" | "error";

/** Plugin 可观察快照。 */
export interface PluginSnapshot {
  /** Plugin 稳定 ID。 */ readonly name: string;
  /** Plugin 用户可见标题。 */ readonly title: string;
  /** Plugin 用途说明。 */ readonly description: string;
  /** 当前运行状态。 */ readonly status: PluginState;
  /** 注册时间戳。 */ readonly registered_at: number;
  /** 最近更新时间戳。 */ readonly updated_at: number;
  /** 最近错误。 */ readonly last_error?: string;
}

/** Plugin 概览。 */
export interface PluginView {
  /** Plugin 稳定 ID。 */ readonly name: string;
  /** Plugin 标题。 */ readonly title: string;
  /** Plugin 描述。 */ readonly description: string;
  /** Action ID 列表。 */ readonly actions: string[];
  /** Pipeline 点列表。 */ readonly pipelines: string[];
  /** Guard 点列表。 */ readonly guards: string[];
  /** Effect 点列表。 */ readonly effects: string[];
  /** Resolve 点列表。 */ readonly resolves: string[];
  /** 是否提供 system。 */ readonly has_system: boolean;
  /** 是否提供 availability。 */ readonly has_availability: boolean;
}

/** Plugin Action 元数据视图。 */
export interface PluginActionReadView {
  /** Action ID。 */ readonly name: string;
  /** Action 描述。 */ readonly description: string;
  /** 是否有输入 schema。 */ readonly has_input_schema: boolean;
  /** JSON Schema。 */ readonly input_schema?: PluginJsonValue;
  /** Action 示例。 */ readonly examples?: PluginActionExample[];
  /** 是否提供 CLI 适配。 */ readonly has_command: boolean;
  /** 是否提供 HTTP 适配。 */ readonly has_api: boolean;
}

/** Plugin 详情视图。 */
export interface PluginReadView {
  /** Plugin ID。 */ readonly name: string;
  /** Plugin 标题。 */ readonly title: string;
  /** Plugin 描述。 */ readonly description: string;
  /** Action 元数据。 */ readonly actions: PluginActionReadView[];
}

/** 统一入口模块激活时获得的 Main 上下文。 */
export type CityPluginMainContext = PluginMainContext;
