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

/** Tool 的稳定视觉语义；按注册名识别。 */
export type AgentToolVisualKind = "read" | "write" | "edit" | "grep" | "find" | "shell" | "ask" | "plugin" | "generic";

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
 * 活动行与展开详情的完整展示信息。
 *
 * Tool 与 Action 都由纯映射产出这一结构，组件只渲染结果，不按 Tool 名或 action_type 分支。
 */
export interface AgentActivityPresentation {
  /** 图表种类，决定行首图标。 */
  visual_kind: AgentToolVisualKind | AgentActionVisualKind;
  /** 当前生命周期对应的翻译 key。 */
  state_key: string;
  /** 活动行样式语气。 */
  tone: AgentActivityTone;
  /** 活动行的单行摘要。 */
  summary: string;
  /** 展开详情；null 表示没有可展开内容。 */
  detail: AgentActivityDetail | null;
  /** 失败原因；为空表示没有失败信息。 */
  error: string;
  /** 输入仍在流式到达，详情末尾显示输入光标。 */
  input_streaming: boolean;
}
