/**
 * Skill Power Mainview 与宿主 action 之间的 JSON 协议。
 *
 * 关键点（中文）
 * - 页面分两层：全局目录（用户目录里的 Skill）与单个 Agent（已绑定的 Skill）。
 * - 可关联来源只有用户目录 `~/.agents/skills`；不做 Workspace 维度，也不在界面里安装。
 * - 来源路径仅供展示；读取只接受目录 ID 与 Agent ID，宿主重新发现实际文件。
 */

import type { McpServerStatus } from "@/mcp/types/Mcp.js";

/** Safe global MCP summary; connection credentials stay in config actions. */
export interface SkillMainviewMcpServer extends McpServerStatus {
  /** User-visible title from the global definition, falling back to its ID. */
  readonly title: string;
  /** Whether the global definition permits connections. */
  readonly enabled: boolean;
  /** Registered Agents currently assigned this global server. */
  readonly linked_agent_ids: string[];
}

/** Host-resolved identity shared by entries pointing at the same real directory. */
export interface SkillMainviewResource {
  /** Opaque identity derived from the canonical directory; never accepted as a read path. */
  readonly resource_id: string;
  /** Installed entry's absolute directory path, for source display only. */
  readonly source_path: string;
}

/** 功能页展示的一条 Agent 已绑定 Skill。 */
export interface SkillMainviewItem extends SkillMainviewResource {
  /**
   * Skill 的稳定目录 ID。
   */
  readonly id: string;

  /**
   * Skill 的用户可见名称。
   */
  readonly name: string;

  /**
   * Skill front matter 中的简要说明。
   */
  readonly description: string;

  /**
   * 该 Skill 在 Agent 目录中是否为软链接。
   *
   * 说明（中文）
   * - 真表示由用户目录关联进来，假表示已复制进 Agent 目录。
   */
  readonly is_link: boolean;

  /**
   * 软链接指向的真实目录；非软链接时不设置。
   */
  readonly link_target?: string;

  /**
   * Skill 声明允许使用的工具名称。
   */
  readonly allowed_tools: string[];
}

/**
 * 用户目录中一条可关联的 Skill。
 */
export interface SkillMainviewAvailableItem extends SkillMainviewResource {
  /**
   * Skill 的稳定目录 ID。
   */
  readonly id: string;

  /**
   * Skill 的用户可见名称。
   */
  readonly name: string;

  /**
   * Skill front matter 中的简要说明。
   */
  readonly description: string;

  /**
   * 该 Skill 已关联到哪些 Agent。
   *
   * 说明（中文）
   * - 按真实资源标识判断，独立复制的同名目录不算共享使用。
   * - 全局页用它展示指向相同真实目录的 Agent。
   */
  readonly linked_agent_ids: string[];
}

/**
 * 一个 Agent 及其已绑定的 Skill。
 */
export interface SkillMainviewAgent {
  /**
   * Agent 的稳定 ID。
   */
  readonly agent_id: string;

  /**
   * Agent 的用户可见名称。
   */
  readonly name: string;

  /**
   * 该 Agent 私有目录中发现的 Skill。
   */
  readonly skills: SkillMainviewItem[];

  /** Explicit MCP allowlist; missing global definitions remain visible by ID for removal. */
  readonly mcp_server_ids: string[];
}

/**
 * Skill 功能页刷新得到的完整快照。
 *
 * 说明（中文）：全局目录与全部 Agent 一次读全，Sidebar 与 Mainview 共用同一份数据。
 */
export interface SkillMainviewSnapshot {
  /**
   * 表示本次快照已经完整生成。
   */
  readonly success: true;

  /**
   * 宿主登记的全部 Agent 及其 Skill。
   */
  readonly agents: SkillMainviewAgent[];

  /**
   * 用户目录中可关联的 Skill。
   */
  readonly available: SkillMainviewAvailableItem[];

  /** Global MCP definitions with safe live state and assignment summaries. */
  readonly mcp_servers: SkillMainviewMcpServer[];
}

/**
 * 读取一个 Skill 的输入。
 */
export interface SkillMainviewReadInput {
  /**
   * 目标 Agent 稳定 ID。
   */
  readonly agent_id: string;

  /**
   * 待读取 Skill 的稳定 ID。
   */
  readonly skill_id: string;
}

/**
 * 读取一个 Skill 的结果。
 */
export interface SkillMainviewReadResult {
  /**
   * 是否成功定位并读取 Skill。
   */
  readonly success: boolean;

  /**
   * 成功时返回的完整 `SKILL.md` 正文。
   */
  readonly content?: string;

  /**
   * 失败时返回的用户可见原因。
   */
  readonly error?: string;
}

/**
 * 关联一个用户目录 Skill 的输入。
 */
export interface SkillMainviewLinkInput {
  /**
   * 目标 Agent 稳定 ID。
   */
  readonly agent_id: string;

  /**
   * 要关联的 Skill 稳定 ID。
   */
  readonly skill_id: string;
}

/**
 * 移除一个 Agent Skill 的输入。
 */
export interface SkillMainviewRemoveInput {
  /**
   * 目标 Agent 稳定 ID。
   */
  readonly agent_id: string;

  /**
   * 要移除的 Skill 稳定 ID。
   */
  readonly skill_id: string;
}

/**
 * Skill 关联或移除后的结果。
 */
export interface SkillMainviewMutationResult extends SkillMainviewSnapshot {
  /**
   * 本次写操作是否成功完成。
   */
  readonly operation_success: boolean;

  /**
   * 写操作失败时的用户可见原因。
   */
  readonly error?: string;
}
