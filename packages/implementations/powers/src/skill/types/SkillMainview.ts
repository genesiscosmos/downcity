/**
 * Skill Power Mainview 与宿主 action 之间的 JSON 协议。
 *
 * 关键点（中文）
 * - 页面以 Agent 为中心：每个 Agent 拥有自己的 Skill 目录。
 * - 该协议只描述用户管理 Skill 所需的稳定数据，不暴露 Agent 运行实例或本地路径。
 */

/**
 * Skill 的可关联来源范围。
 */
export type SkillMainviewScope = "project" | "home";

/**
 * 一个 Skill 的外部来源。
 *
 * 说明（中文）
 * - `project` 指向某个 Workspace 的 `.agents/skills`。
 * - `home` 指向用户目录的 `~/.agents/skills`。
 */
export interface SkillMainviewOrigin {
  /**
   * 来源类型。
   */
  readonly source: SkillMainviewScope;

  /**
   * 项目来源所属 Workspace ID；用户目录来源不设置。
   */
  readonly workspace_id?: string;

  /**
   * 项目来源所属 Workspace 名称；用户目录来源不设置。
   */
  readonly workspace_name?: string;
}

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
   * - 真表示由外部来源关联进来，假表示已复制进 Agent 目录。
   */
  readonly is_link: boolean;

  /**
   * 软链接指向的真实目录；非软链接时不设置。
   */
  readonly link_target?: string;

  /**
   * 软链接对应的外部来源；仅当链接目标落在已知来源根内时设置。
   *
   * 说明（中文）
   * - 用于在界面上说明这条 Skill 来自 project 还是 home，而不是只给一个绝对路径。
   */
  readonly origin?: SkillMainviewOrigin;

  /**
   * Skill 声明允许使用的工具名称。
   */
  readonly allowed_tools: string[];
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
   * - 安装会写入这里，关联会在这里建软链接。
   * - 界面用它回答「到底装到哪」，因此不能省略。
   */
  readonly directory: string;

  /**
   * 该 Agent 私有目录中发现的 Skill。
   */
  readonly skills: SkillMainviewItem[];
}

/**
 * 全局目录中的一条 Skill。
 */
export interface SkillMainviewCatalogItem extends SkillMainviewItem {
  /**
   * Skill 所属来源。
   */
  readonly origin: SkillMainviewOrigin;

  /**
   * 该 Skill 是否已关联到当前 Agent。
   *
   * 说明（中文）
   * - 按 Skill ID 判断，不比较路径。
   */
  readonly linked: boolean;
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
   * 全局可关联目录，按来源分组前的平铺集合。
   */
  readonly catalog: SkillMainviewCatalogItem[];
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

  /**
   * Skill 所属来源范围；`agent` 表示该 Agent 已绑定的 Skill。
   */
  readonly scope: "agent" | SkillMainviewScope;

  /**
   * 项目来源所需的 Workspace ID。
   */
  readonly workspace_id?: string;
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
 * Skills 目录搜索命中的一个安装来源。
 */
export interface SkillMainviewSearchHit {
  /**
   * `skills` CLI 接受的安装 spec。
   */
  readonly spec: string;

  /**
   * 可选的 Skill 名称。
   */
  readonly skill?: string;

  /**
   * 可选的来源页面 URL。
   */
  readonly url?: string;
}

/**
 * Skills 目录搜索结果。
 */
export interface SkillMainviewSearchResult {
  /**
   * 搜索命令是否成功完成。
   */
  readonly success: boolean;

  /**
   * 原始搜索关键词。
   */
  readonly query: string;

  /**
   * 从命令输出中提取并去重的安装来源。
   */
  readonly hits: SkillMainviewSearchHit[];

  /**
   * 搜索失败时的用户可见原因。
   */
  readonly error?: string;
}

/**
 * 安装一个 Skill 的输入。
 */
export interface SkillMainviewInstallInput {
  /**
   * 目标 Agent 稳定 ID。
   */
  readonly agent_id: string;

  /**
   * `skills` CLI 接受的安装 spec。
   */
  readonly spec: string;
}

/**
 * 关联一个已存在 Skill 的输入。
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

  /**
   * Skill 当前所属来源范围。
   */
  readonly scope: SkillMainviewScope;

  /**
   * 项目来源所需的 Workspace ID。
   */
  readonly workspace_id?: string;
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
 * Skill 安装、关联或移除后的结果。
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
