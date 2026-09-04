/**
 * CLI Reporter 类型定义。
 *
 * 关键点（中文）
 * - 为 city CLI 的输出排版提供统一的结构化输入。
 * - 所有命令层只描述“要表达什么”，具体排版交给 reporter 模块。
 * - 类型与渲染器放在同一子域，避免输出协议继续漂移到集中类型目录。
 */

/**
 * CLI 输出区块的语气类型。
 */
export type CliReportTone =
  | "accent"
  | "success"
  | "info"
  | "warning"
  | "error";

/**
 * CLI 输出中的单条键值详情。
 */
export type CliReportFact = {
  /**
   * 当前详情项的标签文本。
   *
   * 说明（中文）
   * - 会作为左侧对齐列展示，例如 `PID`、`Log`、`URL`。
   * - 建议使用短标签，避免过长导致块体视觉松散。
   */
  label: string;
  /**
   * 当前详情项的值文本。
   *
   * 说明（中文）
   * - 会原样展示在右侧内容列。
   * - 调用方应提前完成路径、URL、数字等业务格式化。
   */
  value: string;
};

/**
 * CLI 输出的基础信息区块。
 */
export type CliReportBlock = {
  /**
   * 当前区块的视觉语气。
   *
   * 说明（中文）
   * - 控制前缀符号与颜色。
   * - 未传时默认使用 `info` 语气。
   */
  tone?: CliReportTone;
  /**
   * 当前区块的主标题。
   *
   * 说明（中文）
   * - 应直接表达当前步骤结果，例如 `Control plane started`。
   * - 保持简短，避免与 facts 重复。
   */
  title: string;
  /**
   * 当前区块标题右侧的补充摘要。
   *
   * 说明（中文）
   * - 常用于展示数量、动作阶段等短信息，例如 `1 item`、`restarting`。
   * - 留空时不渲染摘要区域。
   */
  summary?: string;
  /**
   * 当前区块下方要展示的详情列表。
   *
   * 说明（中文）
   * - 详情会按统一列宽对齐输出。
   * - 留空或空数组时不渲染详情行。
   */
  facts?: CliReportFact[];
  /**
   * 当前区块的附注文本。
   *
   * 说明（中文）
   * - 用于补充一句非结构化说明。
   * - 会以弱化样式展示，避免抢主信息层级。
   */
  note?: string;
};

/**
 * CLI 输出中的分组列表项。
 */
export type CliReportListItem = {
  /**
   * 当前列表项的视觉语气。
   *
   * 说明（中文）
   * - 控制该项前缀符号与颜色。
   * - 常见于成功/失败混合列表。
   */
  tone?: CliReportTone;
  /**
   * 当前列表项的主标题。
   *
   * 说明（中文）
   * - 一般展示 agent id、服务名或项目名。
   * - 尽量避免直接塞入大量详情信息。
   */
  title: string;
  /**
   * 当前列表项的详情列表。
   *
   * 说明（中文）
   * - 与 block facts 语义一致，但缩进层级更深。
   * - 用于展示 project_root、PID、log 等补充信息。
   */
  facts?: CliReportFact[];
};

/**
 * CLI 输出中的列表分组。
 */
export type CliReportList = {
  /**
   * 当前列表分组的视觉语气。
   *
   * 说明（中文）
   * - 控制分组标题前缀符号与颜色。
   * - 未传时默认使用 `accent` 语气。
   */
  tone?: CliReportTone;
  /**
   * 当前列表分组的标题。
   *
   * 说明（中文）
   * - 用于概括整个列表，例如 `Managed agents`。
   */
  title: string;
  /**
   * 当前列表分组的补充摘要。
   *
   * 说明（中文）
   * - 常用于数量或动作状态，例如 `stopping · 2 items`。
   */
  summary?: string;
  /**
   * 当前分组下的列表项集合。
   *
   * 说明（中文）
   * - 列表项按给定顺序输出。
   * - 空数组时只展示标题，不展示子项。
   */
  items: CliReportListItem[];
};

/**
 * CLI renderer 的可选渲染控制参数。
 */
export type CliRenderOptions = {
  /**
   * 是否强制启用 ANSI 颜色。
   *
   * 说明（中文）
   * - `true` 时即使在非 TTY 下也会输出颜色。
   * - `false` 时完全关闭颜色，便于测试断言。
   * - 不传时沿用 chalk 默认探测行为。
   */
  color?: boolean;
  /**
   * 当前输出所属的终端命令名。
   *
   * 说明（中文）
   * - `downcity` 只是安装聚合包，实际运行身份应该是 `city` 或 `city`。
   * - 这里用于让 banner 与用户敲下的命令保持一致。
   */
  command_name?: string;
};
