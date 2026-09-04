/**
 * Session Extension 执行协议。
 *
 * Session 只认识 system、pipeline、effect 与 execution lease。City 可以使用
 * Plugin 或其他宿主能力实现本协议，Agent 不感知具体扩展机制。
 */

import type { ModelJsonValue } from "../model/ModelJson.js";
import type { SessionSystemBlock } from "./SessionSystem.js";

/** Session Extension 可观察的来源快照。 */
export interface SessionExtensionOrigin {
  /** 当前来源的稳定非空类型。 */
  readonly type: string;

  /** 当前来源携带的可序列化扩展字段。 */
  readonly [key: string]: ModelJsonValue;
}

/** Session 向 Extension 公开的单次执行快照。 */
export interface SessionExtensionExecutionContext {
  /** 当前 Session 标识；非 Session 调用时为空。 */
  readonly session_id?: string;

  /** 当前 Session 来源；非 Session 调用时为空。 */
  readonly session_origin?: SessionExtensionOrigin;

  /** 当前 Turn 标识；非 Turn 调用时为空。 */
  readonly turn_id?: string;

  /** 当前 Workspace 的逻辑根路径。 */
  readonly project_root?: string;

  /** 当前 Step 已提交的 Workspace 环境快照。 */
  readonly workspace_env?: Readonly<Record<string, string>>;

  /** 当前 Step 已提交的 Agent 指令快照。 */
  readonly agent_systems?: readonly string[];

  /** 当前 Turn 的协作式取消信号。 */
  readonly abort_signal?: AbortSignal;

  /** 当前 Tool 或宿主调用的稳定标识。 */
  readonly call_id?: string;
}

/** Session 执行期间只读的 Extension 能力。 */
export interface SessionExtensionExecutionView {
  /** 解析当前执行视图中生效的 system blocks。 */
  system_blocks(
    execution_context?: SessionExtensionExecutionContext,
  ): Promise<SessionSystemBlock[]>;

  /** 按注册顺序运行一个可转换值的 pipeline 扩展点。 */
  pipeline<TValue = ModelJsonValue>(point_name: string, value: TValue): Promise<TValue>;

  /** 按注册顺序运行一个只产生副作用的 effect 扩展点。 */
  effect<TValue = ModelJsonValue>(point_name: string, value: TValue): Promise<void>;
}

/** 单次 Session Step 持有的 Extension execution lease。 */
export interface SessionExtensionExecutionLease extends SessionExtensionExecutionView {
  /** 幂等释放当前 Step 捕获的长期资源占用。 */
  release(): Promise<void>;
}

/** Session effective 配置持有的 Extension 运行时。 */
export interface SessionExtensionRuntime extends SessionExtensionExecutionView {
  /** 为下一 Step 捕获独立且不可变的 execution lease。 */
  acquire(): SessionExtensionExecutionLease | Promise<SessionExtensionExecutionLease>;
}

/** 创建不提供任何扩展能力的默认 Session Extension Runtime。 */
export function create_empty_session_extensions(): SessionExtensionRuntime {
  const create_view = (): SessionExtensionExecutionLease => ({
    system_blocks: async () => [],
    pipeline: async <TValue>(_point_name: string, value: TValue) => value,
    effect: async () => {},
    release: async () => {},
  });
  return {
    system_blocks: async () => [],
    pipeline: async <TValue>(_point_name: string, value: TValue) => value,
    effect: async () => {},
    acquire: create_view,
  };
}
