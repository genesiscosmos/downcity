/**
 * Skill 命令协议类型。
 *
 * 关键点（中文）
 * - 统一描述 skill list / lookup 相关的 CLI、API 与 plugin action 数据结构。
 * - 这些类型不绑定具体实现模块，避免再次退回到历史 service 目录。
 */

/**
 * skill 摘要信息。
 */
export type SkillSummary = {
  /**
   * skill 稳定标识。
   */
  id: string;
  /**
   * skill 展示名称。
   */
  name: string;
  /**
   * skill 简要描述。
   */
  description: string;
  /**
   * skill 根目录来源类型。
   *
   * 说明（中文）
   * - 例如 user/project/builtin 等来源标识。
   * - 这里只保留稳定字符串，不在类型层强绑定目录实现细节。
   */
  source: string;
  /**
   * `SKILL.md` 的绝对路径。
   */
  skillMdPath: string;
  /**
   * 归一化后的允许工具列表。
   */
  allowedTools: string[];
};

/**
 * skill 列表响应。
 */
export type SkillListResponse = {
  /**
   * 本次列表读取是否成功。
   */
  success: true;
  /**
   * 当前可发现的 skill 摘要集合。
   */
  skills: SkillSummary[];
};

/**
 * skill lookup 请求。
 */
export type SkillLookupRequest = {
  /**
   * 待读取的 skill 名称或标识。
   */
  name: string;
};

/**
 * skill lookup 响应。
 */
export type SkillLookupResponse = {
  /**
   * lookup 是否成功。
   */
  success: boolean;
  /**
   * 命中的 skill 摘要。
   */
  skill?: SkillSummary;
  /**
   * `SKILL.md` 正文内容。
   *
   * 说明（中文）
   * - 仅在命中 skill 且成功读取文件时返回。
   */
  content?: string;
  /**
   * 失败时的错误信息。
   */
  error?: string;
};
