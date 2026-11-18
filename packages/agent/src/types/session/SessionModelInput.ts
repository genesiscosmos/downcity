/** 进程内冻结输入校验与新执行描述；所有内容仅驻留内存。 */
import type { SessionInputMessageVersion } from "../store/SessionInputVersions.js";

/** 原有效输入的进程内内容版本，用于接受 Retry 前校验。 */
export interface SessionModelInputSnapshot {
  /** 完整未修改 ModelCall 的 SHA-256，用于校验内存请求语义。 */
  request_sha256: string;
  /** 输入引用的 canonical 消息身份与内容版本，只驻留当前进程。 */
  messages: SessionInputMessageVersion[];
  /** 输入依赖的本地附件，路径来自已登记的 canonical 消息。 */
  attachments: Array<{
    /** Session 已登记的绝对文件路径。 */
    path: string;
    /** 原步骤文件版本（设备、inode、尺寸与时间戳）的摘要；不重复读取或保存文件正文。 */
    sha256: string;
  }>;
}

/** 已结束执行留下的请求描述；不持有 Turn、输出或取消信号。 */
export interface SessionModelReplay {
  /** 原逻辑 Turn；Retry 仅替换当前方法调用的上下文。 */
  turn_id: string;
  /** 原失败 Step 身份，自动和手动调用共用。 */
  step_id: string;
  /** 原调用的纯数据进度，不持有资源。 */
  checkpoint: SessionStepCheckpoint;
  /** 接收 Retry 时读取的 canonical 消息版本，恢复 Writer 前必须再次匹配。 */
  message_revision?: number;
  /** 普通错误的展示锚点，不是执行身份。 */
  binding: import("@downcity/type").SessionModelRetry;
  /** 失败的完整模型请求，发送时始终复制。 */
  call: import("@downcity/type").ModelCall;
  /** 接收前校验静态配置及原输入引用。 */
  validate: () => Promise<void>;
  /** 为本次有效 Context 重绑定工具，不能引用旧 Context。 */
  bind: (context: import("../turn/SessionTurnContext.js").SessionTurnContext) => Promise<import("./SessionExecution.js").SessionStepExecutionInput>;
}

/** 同一 Turn 的模型循环检查点；仅保留内存数据，不拥有信号、工具或输出。 */
export interface SessionStepCheckpoint {
  /** 已成功完成的模型步骤数，失败步骤不消耗新的预算。 */
  step_count: number;
  /** 已观察到的工具调用总量。 */
  tool_call_count: number;
  /** 已观察到的工具结果总量。 */
  tool_result_count: number;
  /** 已完成模型内容，用于结果聚合；canonical Parts 始终由消息存储拥有。 */
  assistant_parts: import("@downcity/type").SessionAgentMessagePart[];
  /** 已使用的上下文推进预算。 */
  advance_count: number;
  /** 已检测的上下文维护需求。 */
  compact_required: boolean;
}

/** 请求发出前采集的进程内校验能力；不持有执行资源。 */
export interface SessionModelInputValidation {
  /** 当前请求是否仍属于采集时的输入代次。 */
  current: () => boolean;
  /** 校验原消息、附件及静态配置。 */
  validate: () => Promise<void>;
}
