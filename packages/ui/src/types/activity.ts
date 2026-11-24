/** canonical 活动到共享摘要与只读详情的公开展示契约。 */
export type { AgentActivityPart } from "./chat-blocks";
import type { SessionAgentToolPart } from "@downcity/type";
import type { ActivityReadableDetail } from "./activity-readable";
/**
 * Tool 的稳定视觉语义。
 *
 * 关键点（中文）
 * - 内置 Tool 是闭集：Workspace 文件工具与 Agent 的 ask。
 * - `power` 覆盖全部 power，不区分具体是哪一个：power 名无法枚举，图标由 PowerIcon 解析。
 * - 不存在 `shell`：Shell 已收敛为 power，它的图标与状态词都走 power 那一套。
 */
export type AgentToolVisualKind = "read" | "write" | "edit" | "grep" | "find" | "ask" | "power" | "generic";

/**
 * 一次 Tool 调用的稳定身份。
 *
 * 关键点（中文）：身份是「谁在做这件事」，与「对什么做」（摘要/参数）分开。
 * 它替代了此前按 tool_name 子串猜测种类的启发式——上游本来就知道来源，不该在展示层猜。
 */
export type AgentToolIdentity =
  | { /** 内置 Tool；工具名是闭集。 */ kind: "builtin"; /** 内置工具种类。 */ tool: Exclude<AgentToolVisualKind, "power" | "generic"> }
  | { /** Power 工具；power 名即工具名。 */ kind: "power"; /** Power 名，即模型侧工具名。 */ power_name: string; /** Action id；输入尚未收口时为空串。 */ action_name: string }
  | { /** 无法判定来源的工具。 */ kind: "unknown"; /** 原始工具名。 */ tool_name: string };

/** 仅供稳定身份判定使用的公开 Power 事实；领域渲染器由宿主适配。 */
export type ChatPowerLookup = ReadonlyMap<string, {
  /** 面向用户的 Power 标题。 */ title: string;
  /** Power 声明的图标地址；缺失时使用类型图标。 */ icon_url?: string;
}>;

/** Session Action 的稳定视觉语义；按 action_type 识别，未知类别回落为 generic。 */
export type AgentActionVisualKind = "command" | "fork" | "compaction" | "generic";

/**
 * 活动行的图标种类。
 *
 * 它是活动 Part 唯一的图标选择键：Tool 与 Action 各有自己的识别规则。
 * 图标表按 `Record<AgentActivityVisualKind, …>` 定义，新增种类由类型系统强制补全。
 */
export type AgentActivityVisualKind = AgentToolVisualKind | AgentActionVisualKind | "reasoning";

/** 一次编辑的旧文与新文。 */
export interface AgentActivityEditPair {
  /** 被替换的原文。 */ old_text: string;
  /** 替换后的新文。 */ new_text: string;
}

/** 活动展开详情的一种可渲染形态。 */
export type AgentActivityDetail =
  | ActivityReadableDetail
  | { /** 推理详情使用 Markdown 正文。 */ type: "reasoning"; /** 有界的推理原文。 */ text: string; /** 正文超过预览上限时为真。 */ preview_limited?: boolean }
  | { /** 未知工具的普通等宽文本回退。 */ type: "code"; /** 完整正文。 */ text: string };

/** 活动行的样式语气；`complete` 表示已经收口的终态，与 `running` 的推进态相对。 */
export type AgentActivityTone = "running" | "waiting" | "complete" | "failed";

/**
 * 一次文件写入的改动行数。
 *
 * 与 git diff 的 `+N -M` 同一语义，也是 `TurnFileDiffCard` 已经在用的那种计数：
 * 用户不必展开详情就能判断“这一步改了多少”。
 */
export interface AgentActivityDiffStat {
  /** 新增行数。 */
  additions: number;
  /** 删除行数。 */
  deletions: number;
}

/**
 * 活动行与展开详情的完整展示信息。
 *
 * Tool 与 Action 都由纯映射产出这一结构，组件只渲染结果，不按 Tool 名或 action_type 分支。
 */
export interface AgentActivityPresentation {
  /** 文件工具的完整目标路径，用于点击打开 BayBar；不受单行摘要截断影响。 */
  file_path?: string;
  /** 图表种类，决定行首图标。 */
  visual_kind: AgentActivityVisualKind;
  /**
   * Tool 调用的身份；只有 Tool Part 有。
   *
   * 存在时行首图标改由 `PowerIcon` 解析（与 Sidebar、命令面板同一份图标事实源），
   * 且身份文案由它给出（内置工具是「读取文件」，Power 是「Shell · 执行命令」）。
   * Action 与 Reasoning 没有工具身份，它们的主文案就是摘要本身。
   */
  tool_identity?: AgentToolIdentity;
  /** 当前生命周期对应的翻译 key。 */
  state_key: string;
  /** 状态文案中由可靠结果提供的插值，如本次返回数量。 */
  state_values?: Record<string, string>;
  /**
   * canonical Tool 生命周期状态。
   *
   * Power 的状态文案需要在模板里插入动作词（`已{{action}}`），
   * 而 `state_key` 已经是收敛后的翻译 key（六态压成三态），无法反推出原状态，
   * 因此这里保留一份原始状态。Action 没有这个概念，固定为 undefined。
   */
  state?: SessionAgentToolPart["state"];
  /** 活动行样式语气。 */
  tone: AgentActivityTone;
  /**
   * 本次调用的改动行数；非文件写入时为 null。
   *
   * 只有 write / edit 且成功时才有值：写入失败没有产生任何改动，
   * 输入未收口时还不知道会写多少。数据来自 Tool 自己的结构化输出
   *（write 的 `lines_written`、edit 的逐项 `old_text` / `new_text`），不猜。
   */
  diff_stat: AgentActivityDiffStat | null;
  /**
   * 活动行的弱化摘要：目标对象或参数预览，可截断。
   *
   * 内置 Tool 的状态词已经说明了「在做什么」，因此这里只放目标；
   * Power 的「谁在做」由身份文案表达，这里放参数预览。
   */
  summary: string;
  /**
   * 展开时读取详情；缺省表示没有可展开内容。
   *
   * 折叠行只使用摘要，不调用此函数。构造器捕获当前不可变 Part，
   * 在需要正文时才格式化结构化结果、会话记录和编辑对照。
   */
  read_detail?: () => AgentActivityDetail | null;
  /** 失败原因；为空表示没有失败信息。 */
  error: string;
  /** 输入仍在流式到达，详情末尾显示输入光标。 */
  input_streaming: boolean;
}
