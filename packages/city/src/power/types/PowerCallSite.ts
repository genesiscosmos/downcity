/**
 * Power 调用的中立来源身份与容器运行时端口。
 *
 * 关键点（中文）
 * - `PowerCallSite` 是所有入口共同的输入形状：模型工具、检查点 hooks、HTTP/RPC、嵌套调用。
 *   它是 `ToolCallContext` 的结构子集，因此 Session 入口可直接传 `ToolCallContext`，
 *   不需要适配层；HTTP/RPC 入口直接构造字面量，不再伪造 Session 对象。
 * - `PowerRuntimeHost` 是容器实现的能力端口：既负责组装调用环境（`context_for`），
 *   也提供 Power 之间的嵌套调用面（`powers_for`）。依赖是它的字段而非闭包。
 */

import type {
  SessionInteractionPort,
  SessionOrigin,
  WorkspaceRuntime,
} from "@downcity/type";
import type { PowerCityPowers, PowerContext } from "./PowerContext.js";
import type { PowerJsonValue } from "./Json.js";
import type { PowerActionResult, PowerSnapshot } from "./PowerRuntime.js";

/** 一次 Power 调用的来源身份。 */
export interface PowerCallSite {
  /** 发起调用的 Agent 稳定标识。 */
  readonly agent_id: string;

  /** 调用所属 Workspace；缺失时由容器报出装配错误。 */
  readonly workspace?: WorkspaceRuntime;

  /** 调用所属 Session 标识；非 Session 入口为空。 */
  readonly session_id?: string;

  /** 调用所属 Session 来源。 */
  readonly session_origin?: SessionOrigin;

  /** 调用所属 Turn 标识。 */
  readonly turn_id?: string;

  /** 当前 Step 提交的 Workspace 环境快照。 */
  readonly workspace_env?: Readonly<Record<string, string>>;

  /** 当前 Step 提交的 Agent 指令快照。 */
  readonly agent_instructions?: readonly string[];

  /** 上游调用标识；缺失时由容器生成。 */
  readonly call_id?: string;

  /** 上游取消信号。 */
  readonly abort_signal?: AbortSignal;

  /** 上游交互端口；缺失时注入拒绝式实现。 */
  readonly interactions?: SessionInteractionPort;
}

/**
 * 调用身份覆盖。
 *
 * 关键点（中文）：直连入口（`city.powers.scope`）没有 Session 环境，
 * 需要用它与基础来源身份合并，声明本次调用属于哪个 Session / Turn。
 * 只能覆盖身份字段，不能覆盖 agent_id 与 workspace。
 */
export type PowerCallSiteOverride = Pick<
  PowerCallSite,
  "session_id" | "session_origin" | "turn_id" | "workspace_env" | "agent_instructions" | "call_id"
>;

/**
 * 容器为 Power 代码提供的运行时端口。
 *
 * 关键点（中文）
 * - 由 CityPowerRuntime 实现；storage、registry、host 是它的字段。
 * - `context_for` 是唯一的环境组装入口，取代此前的 context_factory 闭包。
 */
export interface PowerRuntimeHost {
  /**
   * 组装指定 Power 在本次调用中的环境。
   *
   * 关键点（中文）：反查 Agent、解析 Workspace 归属、分配 Power 私有存储作用域、
   * 由来源身份派生本次调用，都在这里完成。
   */
  /**
   * 组装指定 Power 在本次调用中的环境。
   *
   * 关键点（中文）：反查 Agent、解析 Workspace 归属、分配 Power 私有存储作用域、
   * 由来源身份派生本次调用，都在这里完成。
   */
  context_for(power_id: string, site: PowerCallSite): PowerContext;

  /** 为指定调用来源构造 Power 之间的调用面。 */
  powers_for(site: PowerCallSite): PowerCityPowers;

  /** 读取指定 power 定义；不存在时返回 null。 */
  get_power(power_id: string): unknown | null;

  /** 列出当前全部 power 快照。 */
  snapshots(): PowerSnapshot[];

  /** 执行一次 power action。 */
  run_action(input: {
    /** Power 名称。 */
    readonly power: string;
    /** Action 名称。 */
    readonly action: string;
    /** 可选 JSON payload。 */
    readonly payload?: PowerJsonValue;
    /** 调用来源身份。 */
    readonly site: PowerCallSite;
  }): Promise<PowerActionResult<PowerJsonValue>>;

  /** 在指定来源身份下运行一个 pipeline 点。 */
  pipeline<TValue extends PowerJsonValue>(
    point_name: string,
    value: TValue,
    site: PowerCallSite,
  ): Promise<TValue>;

  /** 在指定来源身份下运行一个 effect 点。 */
  effect<TValue extends PowerJsonValue>(
    point_name: string,
    value: TValue,
    site: PowerCallSite,
  ): Promise<void>;
}
