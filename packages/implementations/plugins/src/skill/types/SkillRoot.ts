/**
 * Skill root 类型定义。
 *
 * 关键点（中文）
 * - 描述 skill 扫描根路径及其来源优先级。
 * - 该类型只表达结构，不耦合任何扫描实现。
 */

/**
 * skill 根目录来源类型。
 */
export type SkillRootSource = "project" | "home" | "custom";

/**
 * skill 扫描根目录。
 */
export interface SkillRoot {
  /**
   * 根目录来源类型。
   */
  source: SkillRootSource;
  /**
   * 原始配置值。
   *
   * 说明（中文）
   * - 可能是相对路径、绝对路径或带 `~` 的用户目录表达式。
   */
  raw: string;
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
  /**
   * 在禁用外部路径扫描时，是否仍然可信可读。
   */
  trustedWhenExternalDisabled: boolean;
}
