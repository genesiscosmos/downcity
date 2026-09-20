/**
 * 原生隔离策略类型。
 *
 * 关键点（中文）
 * - 这里只描述「语义输入展开成宿主路径规则」之后的结构，不含任何平台分支。
 * - seatbelt profile、bubblewrap argv、路径解释与拒绝翻译都消费同一份结构。
 */

/** 单条路径规则的来源分类。 */
export type PathRuleSource =
  /** Workspace 项目目录，可写。 */
  | "workspace"
  /** Downcity 私有运行目录，可写。 */
  | "runtime"
  /** 宿主显式授权的目录。 */
  | "granted"
  /** 敏感目录，强制只读排除。 */
  | "protected"
  /** 允许写入的临时目录。 */
  | "temp"
  /** 允许写入的设备节点目录。 */
  | "device";

/** 已解析的一条路径规则。 */
export interface ResolvedPathRule {
  /** 宿主侧归一化后的绝对路径。 */
  path: string;
  /** 该路径允许的访问能力。 */
  access: "ro" | "rw";
  /** 规则匹配方式：整棵子树或单个文件。 */
  scope: "subpath" | "literal";
  /** 规则来源，用于回答「这个路径为什么可见」。 */
  source: PathRuleSource;
}

/** 一次解析完成的完整围栏。 */
export interface ResolvedSandboxPolicy {
  /** 出网策略。 */
  network: "allow" | "deny";
  /** 允许写入的路径规则。 */
  write_rules: readonly ResolvedPathRule[];
  /** 强制拒绝读取的敏感路径规则。 */
  deny_read_rules: readonly ResolvedPathRule[];
  /** 允许写入的根路径，用于把拒绝翻译成可执行提示。 */
  writable_roots: readonly string[];
  /** 当前策略的稳定摘要，用于审计还原与变更比对。 */
  digest: string;
}
