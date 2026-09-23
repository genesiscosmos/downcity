/**
 * Skill 扫描根类型定义。
 *
 * 关键点（中文）
 * - Skill 的权威来源是 Agent 私有目录；`project` 与 `home` 只是额外可读来源。
 * - 该类型只表达结构与优先级，不耦合任何扫描实现。
 */

/**
 * Skill 扫描根来源类型。
 *
 * 说明（中文）
 * - `agent`：当前 Agent 私有目录，默认可用集合。
 * - `project`：当前 Workspace 的 `.agents/skills`。
 * - `home`：用户目录的 `~/.agents/skills`。
 */
export type SkillRootSource = "agent" | "project" | "home";

/**
 * Skill 扫描根目录。
 */
export interface SkillRoot {
  /**
   * 根目录来源类型。
   */
  source: SkillRootSource;
  /**
   * 归一化后的绝对路径。
   */
  resolved: string;
  /**
   * 面向用户展示的路径文本。
   */
  display: string;
  /**
   * 扫描优先级。
   *
   * 说明（中文）
   * - 数值越小优先级越高。
   * - 同名 skill 解析时按该字段决定覆盖顺序。
   */
  priority: number;
}
