/**
 * Skill 定义模型。
 *
 * 关键点（中文）
 * - skill 最小单元目录为 `<root>/<skill-id>/SKILL.md`。
 * - 发现逻辑只读取 `SKILL.md` front matter 作为元数据。
 * - 该类型为 skill power 与内部辅助模块的共享事实源。
 */

import type { SkillRootSource } from "@/skill/types/SkillRoot.js";
import type { PowerJsonValue } from "@downcity/city/power";

/**
 * 可被 Agent 发现与读取的 skill 定义。
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
  source_root: string;
  /**
   * skill 目录的绝对路径。
   */
  directory_path: string;
  /**
   * `SKILL.md` 文件的绝对路径。
   */
  skill_md_path: string;
  /**
   * 该 skill 目录是否为软链接。
   *
   * 说明（中文）
   * - 用户可以把外部 skill 链接进 Agent 目录，这里用于区分「安装」与「关联」。
   */
  is_link: boolean;
  /**
   * 软链接指向的绝对路径；非软链接时不设置。
   */
  link_target?: string;
  /**
   * front matter 中的 `allowed-tools` 原始值。
   *
   * 说明（中文）
   * - 这里保留原始 JSON 结构，归一化工作交给上层调用方。
   */
  allowed_tools?: PowerJsonValue;
}
