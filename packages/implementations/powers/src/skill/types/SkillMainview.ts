/**
 * Skill Power Mainview 与宿主 action 之间的 JSON 协议。
 *
 * 关键点（中文）
 * - 页面以 Agent 为中心：每个 Agent 拥有自己的 Skill 目录。
 * - 可关联来源只有用户目录 `~/.agents/skills`；不再有 Workspace 维度。
 * - 该协议只描述用户管理 Skill 所需的稳定数据，不暴露 Agent 运行实例或本地路径。
 */

/**
 * 功能页展示的一条 Agent 已绑定 Skill。
 */
export interface SkillMainviewItem {
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
export interface SkillMainviewAvailableItem {
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
   * 该 Skill 是否已关联到当前 Agent。
   *
   * 说明（中文）
   * - 按 Skill ID 判断，不比较路径。
   */
  readonly linked: boolean;
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
   * 该 Agent 的技能目录展示路径。
   *
   * 说明（中文）
   * - 关联会在这里建软链接，界面用它回答「到底装到哪」。
   */
  readonly directory: string;

  /**
   * 该 Agent 私有目录中发现的 Skill。
   */
  readonly skills: SkillMainviewItem[];
}

/**
 * Skill 功能页刷新得到的完整快照。
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
