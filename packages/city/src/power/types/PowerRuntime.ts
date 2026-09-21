/**
 * City PowerDefinition Action、Hook、生命周期与观察协议。
 *
 * 本模块不依赖 Agent 内核；City 通过受限上下文把领域对象投影给 PowerDefinition。
 */

import type { Command } from "commander";
import type { Hono } from "hono";
import type { Context as HonoContext } from "hono";
import type { z } from "zod";
import type {
  AuthRoutePolicy,
  AgentTool,
  SessionAgentContent,
  SessionModelUserContent,
  ToolHookSet,
} from "@downcity/type";
import type { PowerContext } from "./PowerContext.js";
import type { PowerJsonObject, PowerJsonValue } from "./Json.js";
import type { PowerLifecycleContext } from "./PowerHost.js";
import type { StepSnapshot } from "./StepSnapshot.js";
import type { PowerRuntimeHost } from "./PowerCallSite.js";

/** Action 可以追加到 Session 的一条消息。 */
export type PowerActionMessage =
  | {
      /** User 内容在下一 Step 生效。 */
      readonly role: "user";
      /** User 消息内容。 */
      readonly parts: SessionModelUserContent[];
    }
  | {
      /** Agent 内容写入当前回复。 */
      readonly role: "agent";
      /** Agent 消息内容。 */
      readonly parts: SessionAgentContent[];
    };

/** PowerDefinition Action 执行结果。 */
export interface PowerActionResult<TResult extends PowerJsonValue = PowerJsonValue> {
  /** Action 是否成功。 */
  readonly success: boolean;
  /** 可序列化结果数据。 */
  readonly data?: TResult;
  /** 失败时的稳定错误文本。 */
  readonly error?: string;
  /** 面向人类的结果摘要。 */
  readonly message?: string;
  /** Action 执行后写入 Session 的消息。 */
  readonly messages?: PowerActionMessage[];
}

/** 当前调用所属的 Session 执行身份。 */
export interface PowerSessionExecutionScope {
  /** Session 稳定标识。 */
  readonly session_id: string;
  /** Session 来源。 */
  readonly origin: { readonly type: string; readonly [key: string]: PowerJsonValue };
  /** Turn 稳定标识。 */
  readonly turn_id: string;
}

/** PowerDefinition Action 命令输入。 */
export interface PowerActionCommandInput {
  /** 位置参数。 */
  readonly args: string[];
  /** Commander 解析后的选项。 */
  readonly opts: Record<string, PowerJsonValue>;
}

/** PowerDefinition Action 的 CLI 适配声明。 */
export interface PowerActionCommand<TInput extends PowerJsonValue = PowerJsonValue> {
  /** 命令用途说明。 */
  readonly description: string;
  /** 配置 Commander 子命令。 */
  readonly configure?: (command: Command) => void;
  /** 把 CLI 输入映射为 Action payload。 */
  readonly map_input: (input: PowerActionCommandInput) => TInput | Promise<TInput>;
}

/** PowerDefinition Action 的 HTTP 适配声明。 */
export interface PowerActionApi<TInput extends PowerJsonValue = PowerJsonValue> {
  /** HTTP 方法。 */
  readonly method?: "GET" | "POST" | "PUT" | "DELETE";
  /** 相对 PowerDefinition HTTP 根的路径。 */
  readonly path?: string;
  /** 把 HTTP 请求映射为 Action payload。 */
  readonly map_input?: (context: HonoContext) => TInput | Promise<TInput>;
}

/** PowerDefinition Action 调用示例。 */
export interface PowerActionExample<TInput extends PowerJsonValue = PowerJsonValue> {
  /** 示例标题。 */
  readonly title: string;
  /** 示例补充说明。 */
  readonly description?: string;
  /** 示例 payload。 */
  readonly payload: TInput;
}

/** PowerDefinition Action 输入校验与展示 schema。 */
export interface PowerActionInputSchema<TInput extends PowerJsonValue = PowerJsonValue> {
  /** 运行时 Zod 校验器。 */
  readonly zod?: z.ZodTypeAny;
  /** 面向模型与 UI 的 JSON Schema。 */
  readonly json_schema?: PowerJsonObject;
}

/** 单个 PowerDefinition Action。 */
export interface PowerAction<TInput extends PowerJsonValue = PowerJsonValue, TResult extends PowerJsonValue = PowerJsonValue> {
  /** Action 用途说明；进入模型侧动作索引。 */
  readonly description?: string;
  /**
   * 返回结构说明；进入模型侧动作索引，让模型在调用前知道拿到什么。
   *
   * 关键点（中文）
   * - 未声明时索引只给出动作摘要，不描述返回结构。
   */
  readonly returns?: string;
  /**
   * 读写性质。
   *
   * 关键点（中文）
   * - `read` 只读事实；`write` 会消耗额度、写文件或改变外部状态。
   * - 这是准确的元数据，供模型在调用前判断代价，**不**直接触发审批。
   */
  readonly access?: "read" | "write";
  /** Action 输入 schema。 */
  readonly input_schema?: PowerActionInputSchema<TInput>;
  /** Action 示例。 */
  readonly examples?: PowerActionExample<TInput>[];
  /** Action 协作式超时上限。 */
  readonly timeout_ms?: number;
  /** 可选 CLI 适配。 */
  readonly command?: PowerActionCommand<TInput>;
  /** 可选 HTTP 适配。 */
  readonly api?: PowerActionApi<TInput>;
  /** 执行 Action；调用身份与句柄都在 `context` 内。 */
  readonly execute: (input: {
    /** City 创建的动态 PowerDefinition 上下文。 */
    readonly context: PowerContext;
    /** 已校验的 Action payload。 */
    readonly input: TInput;
    /** 当前 PowerDefinition ID。 */
    readonly power_name: string;
    /** 当前 Action ID。 */
    readonly action_name: string;
  }) => PowerActionResult<TResult> | Promise<PowerActionResult<TResult>>;
}

/** PowerDefinition Action 集合。 */
export type PowerActions = Record<string, PowerAction<PowerJsonValue, PowerJsonValue>>;

/** PowerDefinition pipeline 处理器。 */
export type PowerPipelineHook<TValue extends PowerJsonValue = PowerJsonValue> = (input: {
  /** 动态 PowerDefinition 上下文。 */ readonly context: PowerContext;
  /** 当前管线值。 */ readonly value: TValue;
  /** 当前 PowerDefinition ID。 */ readonly power: string;
}) => TValue | Promise<TValue>;

/** PowerDefinition guard 处理器。 */
export type PowerGuardHook<TValue extends PowerJsonValue = PowerJsonValue> = (input: {
  /** 动态 PowerDefinition 上下文。 */ readonly context: PowerContext;
  /** 当前校验值。 */ readonly value: TValue;
  /** 当前 PowerDefinition ID。 */ readonly power: string;
}) => void | Promise<void>;

/** PowerDefinition effect 处理器。 */
export type PowerEffectHook<TValue extends PowerJsonValue = PowerJsonValue> = (input: {
  /** 动态 PowerDefinition 上下文。 */ readonly context: PowerContext;
  /** 当前事件值。 */ readonly value: TValue;
  /** 当前 PowerDefinition ID。 */ readonly power: string;
}) => void | Promise<void>;

/** PowerDefinition resolve 处理器。 */
export type PowerResolveHook<TInput extends PowerJsonValue = PowerJsonValue, TResult extends PowerJsonValue = PowerJsonValue> = (input: {
  /** 动态 PowerDefinition 上下文。 */ readonly context: PowerContext;
  /** 当前解析输入。 */ readonly value: TInput;
  /** 当前 PowerDefinition ID。 */ readonly power: string;
}) => TResult | Promise<TResult>;

/** PowerDefinition Hook 集合。 */
export interface PowerHooks {
  /** Pipeline 点映射。 */ readonly pipeline?: Record<string, PowerPipelineHook[]>;
  /** Guard 点映射。 */ readonly guard?: Record<string, PowerGuardHook[]>;
  /** Effect 点映射。 */ readonly effect?: Record<string, PowerEffectHook[]>;
}

/** PowerDefinition Resolve 点集合。 */
export type PowerResolves = Record<string, PowerResolveHook>;

/** PowerDefinition 当前可用性。 */
export interface PowerAvailability {
  /** 当前 City 是否已经注册此 PowerDefinition。 */ readonly enabled: boolean;
  /** 当前环境是否满足执行要求。 */ readonly available: boolean;
  /** 不可用原因。 */ readonly reasons: string[];
}

/** PowerDefinition 向 City HTTP transport 声明的一组路由。 */
export interface PowerHttpRegistration {
  /** 当前路由组要求的鉴权策略。 */
  readonly auth_policies?: AuthRoutePolicy[];
  /** 把路由注册到 City 提供的隔离应用。 */
  readonly register: (input: {
    /** 当前路由组使用的 Hono 应用。 */
    readonly app: Hono;
    /** 动态读取当前请求对应的 PowerDefinition 上下文。 */
    readonly get_context: () => PowerContext;
    /** 当前 PowerDefinition 稳定 ID。 */
    readonly power_name: string;
  }) => void;
}

/** PowerDefinition 的 HTTP transport 扩展声明。 */
export interface PowerHttpDefinition {
  /** City Server 可挂载的路由。 */
  readonly server?: PowerHttpRegistration;
}

/** City 中一个 PowerDefinition 的 Agent 执行模块。 */
export interface PowerDefinition {
  /** PowerDefinition 稳定 ID。 */ readonly name: string;
  /** PowerDefinition 用户可见标题。 */ readonly title: string;
  /** PowerDefinition 用途说明。 */ readonly description: string;
  /** PowerDefinition Action 集合。 */ readonly actions?: PowerActions;
  /** PowerDefinition Hook 集合。 */ readonly hooks?: PowerHooks;
  /** PowerDefinition Resolve 点集合。 */ readonly resolves?: PowerResolves;
  /** 构建当前执行范围的 system 文本。 */
  readonly system?: (
    context: PowerContext,
    snapshot: StepSnapshot,
  ) => string | Promise<string>;
  /** Power 加入 City 时初始化自身拥有的长期资源；每个 City 只执行一次。 */
  readonly initialize?: (context: PowerLifecycleContext) => void | Promise<void>;
  /** Power 离开 City且已有调用收口后释放自身拥有的长期资源。 */
  readonly dispose?: (context: PowerLifecycleContext) => void | Promise<void>;
  /** 检查当前动态上下文的可用性。 */
  readonly availability?: (context: PowerContext) => PowerAvailability | Promise<PowerAvailability>;
  /** PowerDefinition 的可选 HTTP 路由声明。 */
  readonly http?: PowerHttpDefinition;

  /**
   * 编译为模型侧工具。
   *
   * 关键点（中文）：工具闭包持有本实例与容器端口，执行时不再回到 Registry；
   * 没有动作的 Power 返回 null，不产生空壳工具。
   */
  compile_tool(host: PowerRuntimeHost): AgentTool | null;

  /** 编译为按检查点索引的处理器集合。 */
  compile_hooks(host: PowerRuntimeHost): ToolHookSet;
}

/** City 可注册的 PowerDefinition 静态定义与入口。 */
export interface CityPowerRegistration {
  /** 用户文档绝对路径。 */ readonly readme: string;
  /** 是否提供设置界面。 */ readonly has_config: boolean;
  /** 是否提供 Sidebar。 */ readonly has_sidebar: boolean;
  /** 是否提供 Mainview。 */ readonly has_mainview: boolean;
  /** City 持有的唯一 PowerDefinition 实例。 */ readonly power: PowerDefinition;
}

/** PowerDefinition 当前运行状态。 */
export type PowerState = "initializing" | "ready" | "error";

/** PowerDefinition 可观察快照。 */
export interface PowerSnapshot {
  /** PowerDefinition 稳定 ID。 */ readonly name: string;
  /** PowerDefinition 用户可见标题。 */ readonly title: string;
  /** PowerDefinition 用途说明。 */ readonly description: string;
  /** 当前运行状态。 */ readonly status: PowerState;
  /** 注册时间戳。 */ readonly registered_at: number;
  /** 最近更新时间戳。 */ readonly updated_at: number;
  /** 最近错误。 */ readonly last_error?: string;
}

/** PowerDefinition 概览。 */
export interface PowerView {
  /** PowerDefinition 稳定 ID。 */ readonly name: string;
  /** PowerDefinition 标题。 */ readonly title: string;
  /** PowerDefinition 描述。 */ readonly description: string;
  /** Action ID 列表。 */ readonly actions: string[];
  /** Pipeline 点列表。 */ readonly pipelines: string[];
  /** Guard 点列表。 */ readonly guards: string[];
  /** Effect 点列表。 */ readonly effects: string[];
  /** Resolve 点列表。 */ readonly resolves: string[];
  /** 是否提供 system。 */ readonly has_system: boolean;
  /** 是否提供 availability。 */ readonly has_availability: boolean;
}

/** PowerDefinition Action 元数据视图。 */
export interface PowerActionReadView {
  /** Action ID。 */ readonly name: string;
  /** Action 描述。 */ readonly description: string;
  /** 读写性质；未声明时为 read。 */ readonly access: "read" | "write";
  /** 返回结构说明；未声明时为空串。 */ readonly returns: string;
  /** 是否有输入 schema。 */ readonly has_input_schema: boolean;
  /** JSON Schema。 */ readonly input_schema?: PowerJsonValue;
  /** Action 示例。 */ readonly examples?: PowerActionExample[];
  /** 是否提供 CLI 适配。 */ readonly has_command: boolean;
  /** 是否提供 HTTP 适配。 */ readonly has_api: boolean;
}

/** PowerDefinition 详情视图。 */
export interface PowerReadView {
  /** PowerDefinition ID。 */ readonly name: string;
  /** PowerDefinition 标题。 */ readonly title: string;
  /** PowerDefinition 描述。 */ readonly description: string;
  /** Action 元数据。 */ readonly actions: PowerActionReadView[];
}
