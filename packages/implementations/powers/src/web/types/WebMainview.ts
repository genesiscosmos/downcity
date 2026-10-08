/**
 * Web Power 工作区与宿主动作之间的 JSON 协议。
 *
 * 关键点（中文）
 * - 配置是 Power 级的单一存储，与 Agent / Workspace 无关，因此协议里没有执行范围。
 * - 配置按能力组织：Provider 选择与它自己的参数属于同一个能力分组。
 * - API Key 永不进入本协议；这里只出现「是否已配置」。
 * - 所有事实都来自 WebPower 自己的 Provider 解析结果，界面不重复推断可用性。
 */

import type { WebConfigView } from "@/web/types/WebPowerConfig.js";

/**
 * 工作区的一个视图。
 *
 * 前三项是真实能力，各自有 Provider 子项与开关；`general` 是跨能力配置与配置文件的归属，
 * 没有 Provider。
 */
export type WebCapability = "search" | "document" | "browser" | "general";

/** 有 Provider 子项的真实能力；`general` 不在其中。 */
export type WebProviderCapability = Exclude<WebCapability, "general">;

/** 一个能力区的状态。 */
export interface WebMainviewCapabilityStatus {
  /** 当前实际生效的 Provider 名称；不可用时为空。 */
  readonly provider: string;

  /** 当前是否已配置并可用。 */
  readonly available: boolean;

  /** 不可用或需要注意时的说明。 */
  readonly note: string;
}

/** Web 工作区一次读取返回的完整快照。 */
export interface WebMainviewSnapshot {
  /** 已脱敏的配置，用于渲染各能力的 Provider 选择与参数。 */
  readonly config: WebConfigView;

  /**
   * 当前配置的持久化文件绝对路径；无文件存储时为空。
   *
   * 由宿主告知，界面只展示与打开，不拼路径也不读写文件。
   */
  readonly config_path: string;

  /** 搜索能力状态。 */
  readonly search: WebMainviewCapabilityStatus;

  /** 网页读取能力状态。 */
  readonly document: WebMainviewCapabilityStatus;

  /** 浏览器能力状态。 */
  readonly browser: WebMainviewCapabilityStatus;

  /** Provider 返回的非致命警告。 */
  readonly warnings: string[];
}

/** 一个活跃浏览器会话的摘要。 */
export interface WebMainviewSession {
  /** session 稳定标识。 */
  readonly session_id: string;

  /** 当前页面 URL。 */
  readonly url: string;

  /** 当前页面标题。 */
  readonly title: string;

  /** 最近一次 observation 的代次。 */
  readonly observation_generation: number;
}

/** 列出浏览器会话的结果。 */
export interface WebMainviewSessionsResult {
  /** 当前是否已配置浏览器能力。 */
  readonly available: boolean;

  /** 当前仍由 Provider 拥有的会话。 */
  readonly sessions: WebMainviewSession[];

  /** 不可用时或读取失败时的说明。 */
  readonly note: string;
}
