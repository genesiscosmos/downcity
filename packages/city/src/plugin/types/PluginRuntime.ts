/**
 * City PluginDefinition Action、Hook、生命周期与观察协议。
 *
 * 本模块不依赖 Agent 内核；City 通过受限上下文把领域对象投影给 PluginDefinition。
 */

import type { Command } from "commander";
import type { Hono } from "hono";
import type { Context as HonoContext } from "hono";
import type { z } from "zod";
import type { AuthRoutePolicy } from "@downcity/type";
import type { PluginContext } from "./PluginContext.js";
import type { PluginJsonObject, PluginJsonValue } from "./Json.js";
import type { PluginStartContext } from "./PluginHost.js";

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

/** PluginDefinition Action 执行结果。 */
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

/** PluginDefinition 可读取的当前 Step 快照。 */
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

/** PluginDefinition Action 的单次执行上下文。 */
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

/** PluginDefinition Action 命令输入。 */
export interface PluginActionCommandInput {
  /** 位置参数。 */
  readonly args: string[];
  /** Commander 解析后的选项。 */
  readonly opts: Record<string, PluginJsonValue>;
}

/** PluginDefinition Action 的 CLI 适配声明。 */
export interface PluginActionCommand<TInput extends PluginJsonValue = PluginJsonValue> {
  /** 命令用途说明。 */
  readonly description: string;
  /** 配置 Commander 子命令。 */
  readonly configure?: (command: Command) => void;
  /** 把 CLI 输入映射为 Action payload。 */
  readonly map_input: (input: PluginActionCommandInput) => TInput | Promise<TInput>;
}

/** PluginDefinition Action 的 HTTP 适配声明。 */
export interface PluginActionApi<TInput extends PluginJsonValue = PluginJsonValue> {
  /** HTTP 方法。 */
  readonly method?: "GET" | "POST" | "PUT" | "DELETE";
  /** 相对 PluginDefinition HTTP 根的路径。 */
  readonly path?: string;
  /** 把 HTTP 请求映射为 Action payload。 */
  readonly map_input?: (context: HonoContext) => TInput | Promise<TInput>;
}

/** PluginDefinition Action 调用示例。 */
export interface PluginActionExample<TInput extends PluginJsonValue = PluginJsonValue> {
  /** 示例标题。 */
  readonly title: string;
  /** 示例补充说明。 */
  readonly description?: string;
  /** 示例 payload。 */
  readonly payload: TInput;
}

/** PluginDefinition Action 输入校验与展示 schema。 */
export interface PluginActionInputSchema<TInput extends PluginJsonValue = PluginJsonValue> {
  /** 运行时 Zod 校验器。 */
  readonly zod?: z.ZodTypeAny;
  /** 面向模型与 UI 的 JSON Schema。 */
  readonly json_schema?: PluginJsonObject;
}

/** 单个 PluginDefinition Action。 */
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
    /** City 创建的动态 PluginDefinition 上下文。 */
    readonly context: PluginContext;
    /** 单次 Action 执行身份。 */
    readonly execution: PluginActionExecutionContext;
    /** 已校验的 Action payload。 */
    readonly input: TInput;
    /** 当前 PluginDefinition ID。 */
    readonly plugin_name: string;
    /** 当前 Action ID。 */
    readonly action_name: string;
  }) => PluginActionResult<TResult> | Promise<PluginActionResult<TResult>>;
}

/** PluginDefinition Action 集合。 */
export type PluginActions = Record<string, PluginAction<PluginJsonValue, PluginJsonValue>>;

/** PluginDefinition pipeline 处理器。 */
export type PluginPipelineHook<TValue extends PluginJsonValue = PluginJsonValue> = (input: {
  /** 动态 PluginDefinition 上下文。 */ readonly context: PluginContext;
  /** 当前管线值。 */ readonly value: TValue;
  /** 当前 PluginDefinition ID。 */ readonly plugin: string;
}) => TValue | Promise<TValue>;

/** PluginDefinition guard 处理器。 */
export type PluginGuardHook<TValue extends PluginJsonValue = PluginJsonValue> = (input: {
  /** 动态 PluginDefinition 上下文。 */ readonly context: PluginContext;
  /** 当前校验值。 */ readonly value: TValue;
  /** 当前 PluginDefinition ID。 */ readonly plugin: string;
}) => void | Promise<void>;

/** PluginDefinition effect 处理器。 */
export type PluginEffectHook<TValue extends PluginJsonValue = PluginJsonValue> = (input: {
  /** 动态 PluginDefinition 上下文。 */ readonly context: PluginContext;
  /** 当前事件值。 */ readonly value: TValue;
  /** 当前 PluginDefinition ID。 */ readonly plugin: string;
}) => void | Promise<void>;

/** PluginDefinition resolve 处理器。 */
export type PluginResolveHook<TInput extends PluginJsonValue = PluginJsonValue, TResult extends PluginJsonValue = PluginJsonValue> = (input: {
  /** 动态 PluginDefinition 上下文。 */ readonly context: PluginContext;
  /** 当前解析输入。 */ readonly value: TInput;
  /** 当前 PluginDefinition ID。 */ readonly plugin: string;
}) => TResult | Promise<TResult>;

/** PluginDefinition Hook 集合。 */
export interface PluginHooks {
  /** Pipeline 点映射。 */ readonly pipeline?: Record<string, PluginPipelineHook[]>;
  /** Guard 点映射。 */ readonly guard?: Record<string, PluginGuardHook[]>;
  /** Effect 点映射。 */ readonly effect?: Record<string, PluginEffectHook[]>;
}

/** PluginDefinition Resolve 点集合。 */
export type PluginResolves = Record<string, PluginResolveHook>;

/** PluginDefinition 当前可用性。 */
export interface PluginAvailability {
  /** 当前 City 是否已经注册此 PluginDefinition。 */ readonly enabled: boolean;
  /** 当前环境是否满足执行要求。 */ readonly available: boolean;
  /** 不可用原因。 */ readonly reasons: string[];
}

/** PluginDefinition 向 City HTTP transport 声明的一组路由。 */
export interface PluginHttpRegistration {
  /** 当前路由组要求的鉴权策略。 */
  readonly auth_policies?: AuthRoutePolicy[];
  /** 把路由注册到 City 提供的隔离应用。 */
  readonly register: (input: {
    /** 当前路由组使用的 Hono 应用。 */
    readonly app: Hono;
    /** 动态读取当前请求对应的 PluginDefinition 上下文。 */
    readonly get_context: () => PluginContext;
    /** 当前 PluginDefinition 稳定 ID。 */
    readonly plugin_name: string;
  }) => void;
}

/** PluginDefinition 的 HTTP transport 扩展声明。 */
export interface PluginHttpDefinition {
  /** City Server 可挂载的路由。 */
  readonly server?: PluginHttpRegistration;
}

/** City 中一个 PluginDefinition 的 Agent 执行模块。 */
export interface PluginDefinition {
  /** PluginDefinition 稳定 ID。 */ readonly name: string;
  /** PluginDefinition 用户可见标题。 */ readonly title: string;
  /** PluginDefinition 用途说明。 */ readonly description: string;
  /** PluginDefinition Action 集合。 */ readonly actions?: PluginActions;
  /** PluginDefinition Hook 集合。 */ readonly hooks?: PluginHooks;
  /** PluginDefinition Resolve 点集合。 */ readonly resolves?: PluginResolves;
  /** 构建当前执行范围的 system 文本。 */
  readonly system?: (context: PluginContext, execution_context?: PluginExecutionContext) => string | Promise<string>;
  /** Plugin 加入 City 时注册宿主动作并启动全局长期资源；每个 City 只执行一次。 */
  readonly start?: (context: PluginStartContext) => void | Promise<void>;
  /** 首次形成 Agent/Workspace 调用作用域时建立局部资源。 */
  readonly connect?: (context: PluginContext) => void | Promise<void>;
  /** Agent/Workspace 调用作用域释放时清理局部资源。 */
  readonly disconnect?: (context: PluginContext) => void | Promise<void>;
  /** Plugin 离开 City 且已有调用收口后停止全局长期资源。 */
  readonly stop?: (context: PluginStartContext) => void | Promise<void>;
  /** 检查当前动态上下文的可用性。 */
  readonly availability?: (context: PluginContext) => PluginAvailability | Promise<PluginAvailability>;
  /** PluginDefinition 的可选 HTTP 路由声明。 */
  readonly http?: PluginHttpDefinition;
}

/** City 可注册的 PluginDefinition 静态定义与入口。 */
export interface CityPluginRegistration {
  /** 用户文档绝对路径。 */ readonly readme: string;
  /** 是否提供设置界面。 */ readonly has_config: boolean;
  /** 是否提供 Sidebar。 */ readonly has_sidebar: boolean;
  /** 是否提供 Mainview。 */ readonly has_mainview: boolean;
  /** City 持有的唯一 PluginDefinition 实例。 */ readonly plugin: PluginDefinition;
}

/** PluginDefinition 当前运行状态。 */
export type PluginState = "initializing" | "ready" | "error";

/** PluginDefinition 可观察快照。 */
export interface PluginSnapshot {
  /** PluginDefinition 稳定 ID。 */ readonly name: string;
  /** PluginDefinition 用户可见标题。 */ readonly title: string;
  /** PluginDefinition 用途说明。 */ readonly description: string;
  /** 当前运行状态。 */ readonly status: PluginState;
  /** 注册时间戳。 */ readonly registered_at: number;
  /** 最近更新时间戳。 */ readonly updated_at: number;
  /** 最近错误。 */ readonly last_error?: string;
}

/** PluginDefinition 概览。 */
export interface PluginView {
  /** PluginDefinition 稳定 ID。 */ readonly name: string;
  /** PluginDefinition 标题。 */ readonly title: string;
  /** PluginDefinition 描述。 */ readonly description: string;
  /** Action ID 列表。 */ readonly actions: string[];
  /** Pipeline 点列表。 */ readonly pipelines: string[];
  /** Guard 点列表。 */ readonly guards: string[];
  /** Effect 点列表。 */ readonly effects: string[];
  /** Resolve 点列表。 */ readonly resolves: string[];
  /** 是否提供 system。 */ readonly has_system: boolean;
  /** 是否提供 availability。 */ readonly has_availability: boolean;
}

/** PluginDefinition Action 元数据视图。 */
export interface PluginActionReadView {
  /** Action ID。 */ readonly name: string;
  /** Action 描述。 */ readonly description: string;
  /** 是否有输入 schema。 */ readonly has_input_schema: boolean;
  /** JSON Schema。 */ readonly input_schema?: PluginJsonValue;
  /** Action 示例。 */ readonly examples?: PluginActionExample[];
  /** 是否提供 CLI 适配。 */ readonly has_command: boolean;
  /** 是否提供 HTTP 适配。 */ readonly has_api: boolean;
}

/** PluginDefinition 详情视图。 */
export interface PluginReadView {
  /** PluginDefinition ID。 */ readonly name: string;
  /** PluginDefinition 标题。 */ readonly title: string;
  /** PluginDefinition 描述。 */ readonly description: string;
  /** Action 元数据。 */ readonly actions: PluginActionReadView[];
}
