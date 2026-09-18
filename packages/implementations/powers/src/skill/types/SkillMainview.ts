/**
 * Skill Power Mainview 与宿主 action 之间的 JSON 协议。
 *
 * 该协议只描述用户管理 Skill 所需的稳定数据，不暴露 Agent 运行实例或宿主 Repository。
 */

/** Skill 功能页支持的本地配置范围。 */
export type SkillMainviewScope = "home" | "workspace";

/** 功能页展示的一条 Skill 摘要。 */
export interface SkillMainviewItem {
  /** Skill 的稳定目录 ID。 */
  readonly id: string;

  /** Skill 的用户可见名称。 */
  readonly name: string;

  /** Skill front matter 中的简要说明。 */
  readonly description: string;

  /** Skill 所属的本地配置范围。 */
  readonly scope: SkillMainviewScope;

  /** Workspace Skill 所属的 Workspace ID；个人 Skill 不设置。 */
  readonly workspace_id?: string;

  /** Skill 声明允许使用的工具名称。 */
  readonly allowed_tools: string[];
}

/** 功能页可选择的一个 Workspace。 */
export interface SkillMainviewWorkspace {
  /** Workspace 的稳定 ID。 */
  readonly workspace_id: string;

  /** Workspace 的用户可见名称。 */
  readonly name: string;

  /** 当前 Workspace 中发现的 Skill。 */
  readonly skills: SkillMainviewItem[];
}

/** Skill 功能页刷新得到的完整快照。 */
export interface SkillMainviewSnapshot {
  /** 表示本次快照已经完整生成。 */
  readonly success: true;

  /** 宿主登记的全部 Workspace 及其 Skill。 */
  readonly workspaces: SkillMainviewWorkspace[];

  /** 用户目录中发现的个人 Skill。 */
  readonly home_skills: SkillMainviewItem[];
}

/** 读取一个本地 Skill 的输入。 */
export interface SkillMainviewReadInput {
  /** Skill 所属的本地配置范围。 */
  readonly scope: SkillMainviewScope;

  /** 待读取 Skill 的稳定 ID。 */
  readonly skill_id: string;

  /** Workspace 范围所需的 Workspace ID。 */
  readonly workspace_id?: string;
}

/** 读取一个本地 Skill 的结果。 */
export interface SkillMainviewReadResult {
  /** 是否成功定位并读取 Skill。 */
  readonly success: boolean;

  /** 成功时返回的完整 `SKILL.md` 正文。 */
  readonly content?: string;

  /** 失败时返回的用户可见原因。 */
  readonly error?: string;
}

/** Skills 目录搜索命中的一个安装来源。 */
export interface SkillMainviewSearchHit {
  /** `skills` CLI 接受的安装 spec。 */
  readonly spec: string;

  /** 可选的 Skill 名称。 */
  readonly skill?: string;

  /** 可选的来源页面 URL。 */
  readonly url?: string;
}

/** Skills 目录搜索结果。 */
export interface SkillMainviewSearchResult {
  /** 搜索命令是否成功完成。 */
  readonly success: boolean;

  /** 原始搜索关键词。 */
  readonly query: string;

  /** 从命令输出中提取并去重的安装来源。 */
  readonly hits: SkillMainviewSearchHit[];

  /** 搜索失败时的用户可见原因。 */
  readonly error?: string;
}

/** 安装一个 Skill 的输入。 */
export interface SkillMainviewInstallInput {
  /** 要安装到个人目录或指定 Workspace。 */
  readonly scope: SkillMainviewScope;

  /** `skills` CLI 接受的安装 spec。 */
  readonly spec: string;

  /** Workspace 范围所需的 Workspace ID。 */
  readonly workspace_id?: string;
}

/** 删除一个本地 Skill 的输入。 */
export interface SkillMainviewRemoveInput {
  /** Skill 所属的本地配置范围。 */
  readonly scope: SkillMainviewScope;

  /** 要删除的 Skill 稳定 ID。 */
  readonly skill_id: string;

  /** Workspace 范围所需的 Workspace ID。 */
  readonly workspace_id?: string;
}

/** Skill 安装或删除后的结果。 */
export interface SkillMainviewMutationResult extends SkillMainviewSnapshot {
  /** 本次写操作是否成功完成。 */
  readonly operation_success: boolean;

  /** 写操作失败时的用户可见原因。 */
  readonly error?: string;
}

/** skills CLI 成功执行后的内部结果。 */
export interface SkillMainviewCliSuccess {
  /** 表示进程以零状态退出。 */
  readonly success: true;

  /** 已删除 ANSI 序列的完整输出。 */
  readonly output: string;
}

/** skills CLI 执行失败后的内部结果。 */
export interface SkillMainviewCliFailure {
  /** 表示进程启动、超时或退出状态失败。 */
  readonly success: false;

  /** 可直接反馈给用户的失败原因。 */
  readonly error: string;
}

/** skills CLI 一次执行的互斥结果。 */
export type SkillMainviewCliResult =
  | SkillMainviewCliSuccess
  | SkillMainviewCliFailure;
