/**
 * Session Turn 执行结果与输入类型。
 *
 * 关键点（中文）
 * - `SessionTurnExecutionInput` 表示上层 Turn 执行入口输入。
 * - `SessionStepExecutionInput` 表示执行器收到的、已装配完成的一步输入。
 * - 输出只返回执行结果；Assistant Message 通过显式输出端口写入唯一事实源。
 */

import type {
  ModelClient,
  ModelMessage,
} from "@downcity/type";
import type { BoundAgentTool } from "@/types/tool/BoundAgentTool.js";
import type { SessionSystemMessage } from "@downcity/type";
import type { SessionTurnContext } from "@/types/turn/SessionTurnContext.js";

/**
 * Session 执行结果。
 */
export interface SessionTurnExecutionResult {
  /**
   * 本轮执行是否成功。
   */
  success: boolean;

  /** 本轮最终用户可见文本，不承载 Assistant Message 快照。 */
  text: string;

  /**
   * 失败时的错误信息（成功时为空）。
   */
  error?: string;

  /** 仅本次执行内保留的原始异常，不序列化进 Turn 结果或业务消息。 */
  failure?: unknown;

  /**
   * 失败时的稳定错误码；缺省时由 Session 层回退为通用 Turn 失败码。
   *
   * 关键点（中文）
   * - 只用于让上层写入 canonical Error Part 时保留领域语义，不参与执行分支判断。
   * - 成功时为空。
   */
  error_code?: string;

  /**
   * 本轮结束后是否需要把已完成的 canonical 历史持久化压缩。
   *
   * 关键点（中文）
   * - 真实 usage 达到 95% 或本轮已经执行过内存 compact 时为 true。
   * - 上层必须等 Assistant writer 收口后再执行，避免压缩流式草稿。
   */
  compact_required?: boolean;
}

/**
 * Session Turn 执行入口输入。
 */
export interface SessionTurnExecutionInput {
  /**
   * 本轮唯一的显式 Turn 上下文。
   *
   * 关键点（中文）
   * - 这里承载标准模型事件输出、Step 合并与取消信号等跨组件运行期数据。
   * - Context 由 Turn 生命周期所有者创建并在 Turn 收口后释放。
   */
  turn_context: SessionTurnContext;
}

/**
 * Executor 通过 Composer 装配后的中间运行态。
 */
export interface SessionStepExecutionInput {
  /** Retry 首步沿用原 Step 身份，后续步骤正常生成。 */
  retry_step_id?: string;
  /** 当前 Step 使用的模型实例。 */
  model: ModelClient;

  /**
   * 当前轮 system messages。
   */
  system: SessionSystemMessage[];

  /** 当前轮标准模型消息历史。 */
  messages: ModelMessage[];

  /**
   * 当前轮可用工具集合；上下文已在包装层绑定。
   */
  tools: Record<string, BoundAgentTool>;

  /** 工具循环撞顶后的无工具收尾步骤；重试仍保持这一执行约束。 */
  finalization?: boolean;

  /** 人工重试使用的完整请求；不重新生成 system、messages 或参数。 */
  call?: import("@downcity/type").ModelCall;

  /** 新执行首步发送前校验原输入代次；不传递给再次失败后的静态绑定。 */
  validate_replay?: () => Promise<void>;

  /** 只持有未绑定工具及值快照，为新的 Turn 创建执行绑定。 */
  rebind_retry?: (context: SessionTurnContext) => Promise<SessionStepExecutionInput>;

  /** 校验当前配置仍与该步骤绑定一致；只校验静态语义，不重装动态上下文。 */
  validate_retry?: () => Promise<void>;

  /** 当前模型支持的上下文窗口长度。 */
  context_window?: number;

}

