/**
 * Agent 原地重配参数。
 *
 * 关键点（中文）
 * - 用于在不替换 Agent 实例的前提下更新身份与默认能力，使配置变更与正在执行的 Session 解耦。
 * - 每个字段都是可选的：省略表示保持当前值，传入则表示覆盖。
 * - 新会话读取更新后的默认配置；已有 Session 快照和覆盖由 Session 自己持有。
 */

import type { ModelClient } from "@downcity/type";

/** `Agent.reconfigure` 接受的增量配置。 */
export interface AgentReconfigureInput {
  /**
   * 新的个人化姓名。
   *
   * 省略时保持当前名称；传入空字符串时回退到 `agent_id`，与构造语义一致。
   */
  name?: string;

  /** 身份与角色列表；省略时保留当前值，传入 [] 清空，覆盖时去除首尾空白、空项和重复项。 */
  role?: string[];
  /**
   * 新的一句话能力描述。
   *
   * 省略时保持当前描述；传入空字符串表示清空描述。
   */
  description?: string;

  /**
   * 新的静态基础指令。
   *
   * 省略时保持当前指令；传入空字符串或空数组表示清空指令。
   * 归一化规则与构造参数一致：逐条 trim 后丢弃空项。
   */
  instruction?: string | string[];

  /**
   * 新的默认模型。
   *
   * 省略字段时保持当前模型；显式传入 undefined 清空默认模型。Session 级覆盖模型保留。
   */
  model?: ModelClient;
}
