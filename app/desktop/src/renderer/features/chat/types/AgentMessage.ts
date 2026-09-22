/** Agent Message 从 canonical Part 派生的内部展示类型。 */

import type {
  SessionAgentActionPart,
  SessionAgentDataPart,
  SessionAgentErrorPart,
  SessionAgentFilePart,
  SessionAgentReasoningPart,
  SessionAgentTextPart,
  SessionAgentToolPart,
  SessionTurnFileDiffData,
} from "@downcity/agent";

/**
 * 参与连续活动展示的 canonical Agent Part。
 *
 * Reasoning、Tool 与 Action 共享同一个集合，因为它们都是「模型或 Session 做过一件事」的记录，
 * 在时间线上必须按 canonical 顺序连续排列。Action 不是正文，因此不单独成块。
 */
export type AgentActivityPart =
  | SessionAgentReasoningPart
  | SessionAgentToolPart
  | SessionAgentActionPart;

/** Agent Message 中按 canonical 顺序排列的一层展示块。 */
export type AgentMessageBlock =
  | { /** 展示块类型。 */ type: "text"; /** 原始文本 Part。 */ part: SessionAgentTextPart }
  | { /** 展示块类型。 */ type: "activity"; /** 连续的活动 Part。 */ parts: AgentActivityPart[] }
  | { /** 展示块类型。 */ type: "file"; /** 原始文件 Part。 */ part: SessionAgentFilePart }
  | { /** 展示块类型。 */ type: "file-diff"; /** 原始 Data Part。 */ part: SessionAgentDataPart; /** 校验后的文件改动数据。 */ data: SessionTurnFileDiffData }
  | { /** 展示块类型。 */ type: "error"; /** 原始错误 Part。 */ part: SessionAgentErrorPart };

/** 一条 Agent Message 可随 canonical 数据重建的完整展示投影。 */
export interface AgentMessageProjection {
  /** 按 canonical Part 顺序排列的可见展示块。 */ blocks: AgentMessageBlock[];
  /** Copy 与 Quote 使用的普通文本，不包含 Reasoning 或 Tool 输出。 */ text: string;
  /** 当前完成态消息是否具备文本结尾的操作栏资格。 */ show_actions: boolean;
}

/**
 * Tool 的稳定视觉语义。
 *
 * 关键点（中文）
 * - 内置 Tool 是闭集：Workspace 的 read/write/edit/grep/find 与 Agent 的 ask。
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

/** 一个 Power 在活动行展示所需的最小事实。 */
export interface ChatPowerFacts {
  /** Power 的用户可见标题；为空时回退为 power 名。 */
  title: string;
  /** Power 自己声明的可选图标 URL；缺失时由 PowerIcon 回退为语义图标。 */
  icon_url?: string;
}

/**
 * 当前可见 Power 的展示事实表，键为 power 名。
 *
 * 它是「当前有哪些 power」的事实源：命中即 power，不需要猜。
 * 注意 `city` 与 `shell` 由 City 直接注册、不经过 Desktop Power catalog，
 * 因此这张表不一定包含它们；身份判定另有一份显式登记（见 agent_activity_presentation）。
 */
export type ChatPowerLookup = ReadonlyMap<string, ChatPowerFacts>;

/** Session Action 的稳定视觉语义；按 action_type 识别，未知类别回落为 generic。 */
export type AgentActionVisualKind = "command" | "fork" | "compaction" | "generic";

/**
 * 活动行的图标种类。
 *
 * 它是三种活动 Part 唯一的图标选择键：Tool 与 Action 各有自己的识别规则，Reasoning 固定为思考。
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
  | { /** 详情形态固定为等宽代码。 */ type: "code"; /** 完整正文。 */ text: string }
  | { /** 详情形态固定为命令与控制台输出。 */ type: "console"; /** 完整正文。 */ text: string }
  | { /** 详情形态固定为编辑前后对照。 */ type: "edit"; /** 按顺序排列的编辑对。 */ pairs: readonly AgentActivityEditPair[] };

/** 活动行的样式语气；`complete` 表示已经收口的终态，与 `running` 的推进态相对。 */
export type AgentActivityTone = "running" | "complete" | "failed";

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
  /** 图表种类，决定行首图标。 */
  visual_kind: AgentToolVisualKind | AgentActionVisualKind;
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
  /** 展开详情；null 表示没有可展开内容。 */
  detail: AgentActivityDetail | null;
  /** 失败原因；为空表示没有失败信息。 */
  error: string;
  /** 输入仍在流式到达，详情末尾显示输入光标。 */
  input_streaming: boolean;
}
