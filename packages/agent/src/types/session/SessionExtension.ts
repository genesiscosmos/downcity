/**
 * Session 扩展执行端口。
 *
 * 设计边界（中文）：
 * - Session 只依赖 metadata、action、system、pipeline、effect 与 execution lease，不识别 Plugin Registry。
 * - City 可以用 Plugin、测试桩或其他扩展实现此端口。
 * - 一次 Step 捕获一个不可变 lease，配置变化只在下一个检查点生效。
 */

import type { JsonValue } from "@/types/common/Json.js";
import type { AgentSessionSystemBlock } from "@/types/agent/SessionTypes.js";
import type { SessionOrigin } from "@/types/session/SessionOrigin.js";
import type { SessionInteractionPort } from "@/types/session/SessionInteraction.js";
import type { PluginActionResult } from "@downcity/plugin";

/** Session 向扩展运行时公开的只读执行快照。 */
export interface SessionExtensionExecutionContext {
  /** 当前 Session 标识。 */
  readonly session_id?: string;

  /** 当前 Session 来源；非 Session 调用时为空。 */
  readonly session_origin?: SessionOrigin;

  /** 当前 Turn 标识。 */
  readonly turn_id?: string;

  /** 当前 Workspace 根目录。 */
  readonly project_root?: string;

  /** 当前 Step 已提交的 Workspace 环境快照。 */
  readonly workspace_env?: Readonly<Record<string, string>>;

  /** 当前 Step 已提交的 Agent 指令快照。 */
  readonly agent_systems?: readonly string[];

  /** 当前 Turn 的取消信号。 */
  readonly abort_signal?: AbortSignal;

  /** 当前 Tool 或 Action 调用标识。 */
  readonly call_id?: string;
}

/** Session 执行期间只读的扩展能力。 */
export interface SessionExtensionExecutionView {
  /** 读取当前扩展视图中的 Plugin/Action 元数据。 */
  read(params: {
    /** 可选 Plugin 稳定 ID。 */
    readonly plugin?: string;
    /** 可选 Action 稳定 ID；提供时必须同时提供 Plugin。 */
    readonly action?: string;
  }): unknown;

  /** 在当前稳定执行视图中运行一个 Plugin Action。 */
  run_action(params: {
    /** 目标 Plugin 稳定 ID。 */
    readonly plugin: string;
    /** 目标 Action 稳定 ID。 */
    readonly action: string;
    /** 可选 JSON payload。 */
    readonly payload?: JsonValue;
    /** 当前 Session/Turn/Step 的只读执行快照。 */
    readonly execution_context?: SessionExtensionExecutionContext;
    /** 当前 Session 的异步交互端口。 */
    readonly interactions?: SessionInteractionPort;
  }): Promise<PluginActionResult<JsonValue>>;

  /** 解析当前生效的扩展 system blocks。 */
  system_blocks(
    execution_context?: SessionExtensionExecutionContext,
  ): Promise<AgentSessionSystemBlock[]>;

  /** 按注册顺序运行一个 pipeline 扩展点。 */
  pipeline<TValue = JsonValue>(point_name: string, value: TValue): Promise<TValue>;

  /** 按注册顺序运行一个 effect 扩展点。 */
  effect<TValue = JsonValue>(point_name: string, value: TValue): Promise<void>;
}

/** 单次 Session Step 持有的扩展 execution lease。 */
export interface SessionExtensionExecutionLease extends SessionExtensionExecutionView {
  /** 幂等释放当前 Step 捕获的长期资源占用。 */
  release(): Promise<void>;
}

/** Session effective 配置持有的扩展运行时。 */
export interface SessionExtensionRuntime extends SessionExtensionExecutionView {
  /** 为下一 Step 捕获独立、不可变的 execution lease。 */
  acquire(): SessionExtensionExecutionLease | Promise<SessionExtensionExecutionLease>;
}

/** 创建不提供任何能力的默认 Session 扩展运行时。 */
export function create_empty_session_extensions(): SessionExtensionRuntime {
  const create_view = (): SessionExtensionExecutionLease => ({
    read: () => ({ plugins: [] }),
    run_action: async ({ plugin }) => ({
      success: false,
      error: `Unknown plugin: ${plugin}`,
      message: `Unknown plugin: ${plugin}`,
    }),
    system_blocks: async () => [],
    pipeline: async <TValue>(_point_name: string, value: TValue) => value,
    effect: async () => {},
    release: async () => {},
  });
  return {
    read: () => ({ plugins: [] }),
    run_action: async ({ plugin }) => ({
      success: false,
      error: `Unknown plugin: ${plugin}`,
      message: `Unknown plugin: ${plugin}`,
    }),
    system_blocks: async () => [],
    pipeline: async <TValue>(_point_name: string, value: TValue) => value,
    effect: async () => {},
    acquire: create_view,
  };
}
