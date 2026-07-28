/**
 * Session Composer 类型。
 *
 * Composer 是自定义 Session 的执行策略边界：它只读取 Session 的只读快照，
 * 负责组装模型输入和生成压缩计划，不持久化 Message、Metadata 或事件。
 */

import type {
  LanguageModel,
  SystemModelMessage,
  Tool,
} from "ai";
import type { SessionRecordV1 } from "@/executor/types/SessionRecords.js";
import type { AgentSessionSystemBlock } from "@/types/agent/SessionTypes.js";
import type { SessionContextSnapshot, SessionSegmentSummary } from "@/types/session/SessionSegment.js";

/** Composer 可读取的 Session 身份快照。 */
export interface SessionComposeIdentity {
  /** 当前 Agent 的稳定标识。 */
  agent_id: string;
  /** 当前 Session 的稳定标识。 */
  session_id: string;
  /** 当前 Agent 项目的绝对根目录。 */
  project_root: string;
  /** 当前 Session 的创建时间戳，单位为毫秒。 */
  created_at: number;
  /** 当前 Session 使用的参考时区。 */
  timezone: string;
}

/** Composer 可读取的当前 Step 生效状态。 */
export interface SessionComposeState {
  /** 当前 Step 使用的模型实例；只读查询允许为空。 */
  model?: LanguageModel;
  /** 当前模型声明的上下文窗口，单位为 token。 */
  model_context_window?: number;
  /** 当前 Step 生效的 Agent 环境变量快照。 */
  env: Readonly<Record<string, string>>;
  /** 当前 Step 生效的 Agent instruction 文本。 */
  systems: readonly string[];
  /** 当前 Step 可使用的工具集合。 */
  tools: Readonly<Record<string, Tool>>;
  /** 当前 Step 生效的 instruction system blocks。 */
  instruction_system_blocks: readonly AgentSessionSystemBlock[];
  /** 当前 Session 由宿主注入的 system blocks。 */
  managed_plugin_system_blocks: readonly AgentSessionSystemBlock[];
  /** 当前 Step 捕获的 Plugin system blocks。 */
  plugin_system_blocks: readonly AgentSessionSystemBlock[];
}

/** Composer 可读取的当前 Turn 快照。 */
export interface SessionComposeTurn {
  /** 当前 Turn 标识；只读查询场景允许为空。 */
  turn_id?: string;
  /** 当前执行因上下文超限而进行的重试次数。 */
  retry_count: number;
}

/** 单次模型输入组装参数。 */
export interface SessionComposeInput {
  /** 当前 Session 身份快照。 */
  session: SessionComposeIdentity;
  /** 当前 Step 已生效的运行状态。 */
  state: SessionComposeState;
  /** 当前 Session 的累计 Summary 与 Active Message 快照。 */
  history: Readonly<SessionContextSnapshot>;
  /** 当前 Turn 快照。 */
  turn: SessionComposeTurn;
}

/** Composer 为一次模型 Step 生成的完整输入。 */
export interface SessionStepInput {
  /** 当前 Step 的 system messages。 */
  system: SystemModelMessage[];
  /** 当前 Step 的可解释 system block；自定义 Composer 可以省略。 */
  system_blocks?: AgentSessionSystemBlock[];
  /** 当前 Step 的历史与用户消息。 */
  messages: SessionRecordV1[];
  /** 当前 Step 可调用的工具集合。 */
  tools: Record<string, Tool>;
}

/** 持久化上下文压缩所需的最小只读输入。 */
export interface SessionCompactionInput {
  /** 当前 Session 的稳定身份快照。 */
  session: SessionComposeIdentity;
  /** 当前 Session 实际使用的模型；只读或未配置场景允许为空。 */
  model?: LanguageModel;
  /** 当前 Session 的累计 Summary 与 Active Message 快照。 */
  history: Readonly<SessionContextSnapshot>;
}

/** Composer 生成、等待 SessionMessages 提交的压缩计划。 */
export interface SessionCompactionPlan {
  /** Active 中最后一条需要移入 Segment 的 Message sequence。 */
  through_sequence: number;
  /** 新 Segment 使用的累计 Summary。 */
  summary: SessionSegmentSummary;
  /** 当前计划覆盖到的最后一条 Message 标识。 */
  boundary_message_id: string;
  /** Summary 是否因为模型失败而使用了确定性降级内容。 */
  used_fallback: boolean;
}

/** Session 级可替换执行策略。 */
export interface SessionComposer {
  /** Composer 的稳定可读名称。 */
  readonly name: string;

  /** 组装一次模型 Step 使用的 system、history 与 tools。 */
  compose(input: SessionComposeInput): Promise<SessionStepInput>;

  /** 根据只读历史生成压缩计划；无需压缩时返回空。 */
  compact(input: SessionCompactionInput): Promise<SessionCompactionPlan | null>;

  /** 判断给定错误是否应在持久化压缩后重试。 */
  should_compact(error: unknown): boolean;
}
