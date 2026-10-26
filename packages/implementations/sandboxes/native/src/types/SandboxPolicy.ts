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
  /** 敏感目录，强制拒绝访问。 */
  | "protected"
  /** 允许写入的临时目录。 */
  | "temp"
  /** 允许写入的设备节点目录。 */
  | "device";

/** 已解析的一条路径规则。 */
export interface ResolvedPathRule {
  /** 宿主侧归一化后的绝对路径。 */
  path: string;
  /** 文件能力：read 强制只读，write 允许读写，deny 拒绝读写；限制规则优先。 */
  access: "read" | "write" | "deny";
  /** 规则匹配方式：整棵子树或单个文件。 */
  scope: "subpath" | "literal";
  /** 规则来源，用于回答「这个路径为什么可见」。 */
  source: PathRuleSource;
}

/** 一次解析完成的完整围栏。 */
export interface ResolvedSandboxPolicy {
  /** 出网策略。 */
  network: "allow" | "deny";
  /** 完整文件规则；read 与 deny 子树不能被 write 规则重新开放。 */
  filesystem_rules: readonly ResolvedPathRule[];
  /** 允许写入的根路径，用于把拒绝翻译成可执行提示。 */
  writable_roots: readonly string[];
  /** 宿主显式开放的 SSH 只读端点；允许在 protected 子树中精确重开，不开放兄弟文件。 */
  ssh?: {
    /** 已解析的 SSH agent Unix socket 真实路径。 */
    socket_path: string;
    /** 已解析的专用主机信任文件真实路径。 */
    known_hosts_path: string;
  };
  /** 当前策略的稳定摘要，用于审计还原与变更比对。 */
  digest: string;
}
