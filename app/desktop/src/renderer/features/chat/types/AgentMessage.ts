/** Agent Message 从 canonical Part 派生的内部展示类型。 */

import type {
  SessionAgentActionPart,
  SessionAgentDataPart,
  SessionAgentErrorPart,
  SessionAgentFilePart,
  SessionAgentInteractionPart,
  SessionAgentReasoningPart,
  SessionAgentTextPart,
  SessionAgentToolPart,
  SessionTurnFileDiffData,
} from "@downcity/agent";

/** 参与连续活动展示的 canonical Agent Part。 */
export type AgentActivityPart =
  | SessionAgentReasoningPart
  | SessionAgentToolPart
  | SessionAgentInteractionPart;

/** Agent Message 中按 canonical 顺序排列的一层展示块。 */
export type AgentMessageBlock =
  | { /** 展示块类型。 */ type: "text"; /** 原始文本 Part。 */ part: SessionAgentTextPart }
  | { /** 展示块类型。 */ type: "activity"; /** 连续的活动 Part。 */ parts: AgentActivityPart[] }
  | { /** 展示块类型。 */ type: "file"; /** 原始文件 Part。 */ part: SessionAgentFilePart }
  | { /** 展示块类型。 */ type: "file-diff"; /** 原始 Data Part。 */ part: SessionAgentDataPart; /** 校验后的文件改动数据。 */ data: SessionTurnFileDiffData }
  | { /** 展示块类型。 */ type: "action"; /** 原始 Action Part。 */ part: SessionAgentActionPart }
  | { /** 展示块类型。 */ type: "error"; /** 原始错误 Part。 */ part: SessionAgentErrorPart };

/** 一条 Agent Message 可随 canonical 数据重建的完整展示投影。 */
export interface AgentMessageProjection {
  /** 按 canonical Part 顺序排列的可见展示块。 */
  blocks: AgentMessageBlock[];
  /** Copy 与 Quote 使用的普通文本，不包含 Reasoning 或 Tool 输出。 */
  text: string;
  /** 当前完成态消息是否具备文本结尾的操作栏资格。 */
  show_actions: boolean;
}

/** Tool 的稳定视觉语义。 */
export type AgentToolVisualKind = "read" | "write" | "edit" | "grep" | "find" | "shell" | "ask" | "plugin" | "generic";

/** Tool 活动行需要的无状态展示信息。 */
export interface AgentToolPresentation {
  /** Tool 对应的视觉种类。 */
  visual_kind: AgentToolVisualKind;
  /** 当前生命周期对应的翻译 key。 */
  state_key: string;
  /** Tool 操作的单行摘要。 */
  detail: string;
  /** Tool 当前是否仍在运行。 */
  running: boolean;
  /** Tool 当前是否失败。 */
  failed: boolean;
}
