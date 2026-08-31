/**
 * CoreEngine 模型消息运行态。
 *
 * 关键点（中文）
 * - CoreEngine 只维护本 Turn 后续模型 Step 需要的标准 ModelMessage。
 * - canonical SessionMessage 的持久化由 SessionMessages 独立拥有。
 */

import type { ModelMessage } from "@downcity/type";
import { session_messages_to_model_messages } from "@executor/messages/SessionModelMessages.js";
import type { SessionMessage, SessionUserMessage } from "@/types/session/SessionMessage.js";

/**
 * CoreEngine 单轮执行期间的消息基线。
 */
export class CoreEngineMessageState {
  /**
   * 当前模型侧消息基线。
   */
  private current_model_messages: ModelMessage[];

  /**
   * 当前项目根目录，用于解析历史中的相对路径 file part。
   */
  private readonly project_root?: string;

  private constructor(params: {
    /**
     * 当前模型侧消息基线。
     */
    model_messages: ModelMessage[];
    /**
     * 当前项目根目录。
     */
    project_root?: string;
  }) {
    this.current_model_messages = params.model_messages;
    this.project_root = params.project_root;
  }

  /**
   * 基于初始模型消息创建运行态。
   */
  static async create(params: {
    /**
     * 初始标准模型消息。
     */
    messages: ModelMessage[];
    /**
     * 当前项目根目录。
     */
    project_root?: string;
  }): Promise<CoreEngineMessageState> {
    return new CoreEngineMessageState({
      model_messages: Array.isArray(params.messages) ? [...params.messages] : [],
      project_root: params.project_root,
    });
  }

  /**
   * 读取当前模型消息。
   */
  get model_messages(): ModelMessage[] {
    return this.current_model_messages;
  }

  /**
   * 把 Step 间新增的 canonical User Message 并入模型基线。
   */
  async append_merged_user_messages(
    messages: SessionUserMessage[],
  ): Promise<ModelMessage[]> {
    if (messages.length === 0) return [];
    return await this.append_session_messages(messages);
  }

  /**
   * 追加内部生成的 user nudge 消息。
   */
  async append_user_message(message: SessionUserMessage): Promise<void> {
    await this.append_session_messages([message]);
  }

  /**
   * 追加 SDK 返回的模型 response messages。
   */
  append_model_messages(messages: ModelMessage[]): void {
    if (!Array.isArray(messages) || messages.length === 0) return;
    this.current_model_messages = [...this.current_model_messages, ...messages];
  }

  /**
   * 原子替换当前模型侧消息基线。
   *
   * 关键点（中文）：compact 只替换 Provider 后续可见的 ModelMessage，
   * Session 语义消息与持久化历史仍保持完整，等待 turn 收口后再单独归档。
   */
  replace_model_messages(messages: ModelMessage[]): void {
    this.current_model_messages = Array.isArray(messages) ? [...messages] : [];
  }

  /** 使用 Composer 重新生成的模型历史原子替换当前基线。 */
  replace_model_history(messages: ModelMessage[]): void {
    this.current_model_messages = Array.isArray(messages) ? [...messages] : [];
  }

  private async append_session_messages(
    messages: SessionMessage[],
  ): Promise<ModelMessage[]> {
    const model_messages = await session_messages_to_model_messages(
      messages,
      this.project_root,
    );
    this.current_model_messages = [...this.current_model_messages, ...model_messages];
    return model_messages;
  }
}
