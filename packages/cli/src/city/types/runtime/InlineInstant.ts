/**
 * CLI/City Inline 即时执行类型定义。
 *
 * 关键点（中文）
 * - 统一描述 Chrome Extension Inline Composer 的“即时模式”请求与返回。
 * - 即时模式始终走临时 session，执行完成后立即返回文本结果。
 * - executor 只是即时模式的内部执行实现，不再暴露独立产品路径。
 */

/**
 * Inline 即时执行器类型。
 */
export type InlineInstantExecutorType = "model" | "acp";

/**
 * 平台 Inline 即时执行请求输入。
 */
export interface PlatformInlineInstantRunInput {
  /**
   * 本次即时执行选用的 executor 类型。
   */
  executorType: InlineInstantExecutorType;

  /**
   * 用户当前输入的问题或指令。
   */
  prompt: string;

  /**
   * 可选附加 system prompt。
   */
  system?: string;

  /**
   * 可选页面上下文文本。
   *
   * 说明（中文）
   * - 通常由扩展侧把选区或整页快照整理成 Markdown 后传入。
   */
  pageContext?: string;

  /**
   * `model` executor 对应的 City AIService modelId。
   */
  modelId?: string;

  /**
   * `acp` executor 对应的 agent 项目 id。
   *
   * 说明（中文）
   * - 当前实现中等同于 agent 项目根目录绝对路径。
   */
  agent_id?: string;
}

/**
 * 平台 Inline 即时执行结果。
 */
export interface PlatformInlineInstantRunResult {
  /**
   * 本次即时执行内部使用的临时 session_id。
   */
  session_id: string;

  /**
   * 实际执行使用的 executor 类型。
   */
  executorType: InlineInstantExecutorType;

  /**
   * 最终返回给前端展示的文本结果。
   */
  text: string;

  /**
   * 若为 `model` executor，则回传本次命中的 modelId。
   */
  modelId?: string;

  /**
   * 若为 `acp` executor，则回传本次命中的 agent_id。
   */
  agent_id?: string;
}

/**
 * 平台 Inline 即时执行运行端口。
 */
export interface PlatformInlineInstantRunner {
  /**
   * 运行一次即时执行请求。
   */
  run(
    input: PlatformInlineInstantRunInput,
  ): Promise<PlatformInlineInstantRunResult>;
}
