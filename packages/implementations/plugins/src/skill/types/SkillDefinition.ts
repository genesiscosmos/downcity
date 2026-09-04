/**
 * Skill 定义模型。
 *
 * 关键点（中文）
 * - skill 最小单元目录为 `<root>/<skill-id>/SKILL.md`。
 * - 发现逻辑只读取 `SKILL.md` front matter 作为元数据。
 * - 该类型为 skill plugin、CLI 与内部辅助模块的共享事实源。
 */

import type { SkillRootSource } from "@/skill/types/SkillRoot.js";
import type { PluginJsonValue } from "@downcity/city/plugin";

/**
 * 可被 agent 发现与读取的 skill 定义。
 */
export interface SkillDefinition {
  /**
   * skill 稳定标识。
   *
   * 说明（中文）
   * - 通常等于 skill 目录名。
   * - 用于 lookup、去重与排序。
   */
  id: string;
  /**
   * skill 展示名称。
   *
   * 说明（中文）
   * - 优先读取 front matter 中的 `name`。
   * - 若未声明，则回退为 `id`。
   */
  name: string;
  /**
   * skill 简要描述。
   *
   * 说明（中文）
   * - 来自 front matter 的 `description`。
   * - 未声明时为空字符串。
   */
  description: string;
  /**
   * skill 根目录来源类型。
   */
  source: SkillRootSource;
  /**
   * skill 所属根目录的绝对路径。
   */
  sourceRoot: string;
  /**
   * skill 目录的绝对路径。
   */
  directoryPath: string;
  /**
   * `SKILL.md` 文件的绝对路径。
   */
  skillMdPath: string;
  /**
   * front matter 中的 `allowed-tools` 原始值。
   *
   * 说明（中文）
   * - 这里保留原始 JSON 结构，归一化工作交给上层调用方。
   */
  allowedTools?: PluginJsonValue;
}
