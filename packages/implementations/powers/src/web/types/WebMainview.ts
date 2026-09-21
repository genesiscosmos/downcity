/**
 * Web Power Mainview 与宿主 action 之间的 JSON 协议。
 *
 * 关键点（中文）
 * - 界面是只读状态页：展示三类 Provider 的可用性与配置摘要，以及当前浏览器会话。
 * - API Key 永不进入本协议；这里只出现「是否已配置」与存储边界说明。
 * - 所有事实都来自 WebPower 自己的 Provider 解析结果，界面不重复推断可用性。
 */

import type { PowerJsonObject } from "@downcity/city/power";
import type { WebPowerConfigView } from "@/web/types/WebPowerSettings.js";

/** 界面可切换的一个 Agent 执行范围。 */
export interface WebMainviewAgent {
  /** Agent 的稳定 ID。 */
  readonly agent_id: string;

  /** Agent 的用户可见名称。 */
  readonly name: string;
}

/** 界面可切换的一个 Workspace 执行范围。 */
export interface WebMainviewWorkspace {
  /** Workspace 的稳定 ID。 */
  readonly workspace_id: string;

  /** Workspace 的用户可见名称。 */
  readonly name: string;
}

/** 一个能力区的状态。 */
export interface WebMainviewCapabilityStatus {
  /** 当前实际生效的 Provider 名称；不可用时为空。 */
  readonly provider: string;

  /** 当前是否已配置并可用。 */
  readonly available: boolean;

  /** 用户可见的当前选择说明。 */
  readonly selection: string;

  /** 不可用或需要注意时的说明。 */
  readonly note: string;
}

/** Web 工作区一次读取返回的完整快照。 */
export interface WebMainviewSnapshot {
  /** 当前可切换的 Agent 执行范围。 */
  readonly agents: WebMainviewAgent[];

  /** 当前可提供 Workspace 环境的 Workspace。 */
  readonly workspaces: WebMainviewWorkspace[];

  /** 已脱敏的配置摘要，复用 Config 的公开视图。 */
  readonly config: WebPowerConfigView;

  /** 搜索能力状态。 */
  readonly search: WebMainviewCapabilityStatus;

  /** 网页读取能力状态。 */
  readonly document: WebMainviewCapabilityStatus;

  /** 浏览器能力状态。 */
  readonly browser: WebMainviewCapabilityStatus;

  /** 当前实际生效的浏览器 Provider 类型；不可用时为空。 */
  readonly browser_provider: string;

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

/** 快照读取输入。 */
export interface WebMainviewSnapshotInput extends PowerJsonObject {
  /** 用于解析当前配置与可用性的 Agent。 */
  readonly agent_id: string;

  /** 用于解析当前配置与可用性的 Workspace。 */
  readonly workspace_id: string;
}

/** 浏览器会话列表输入。 */
export interface WebMainviewSessionsInput extends PowerJsonObject {
  /** 目标 Agent 执行范围。 */
  readonly agent_id: string;

  /** 提供 Workspace 环境与配置的 Workspace ID。 */
  readonly workspace_id: string;
}
