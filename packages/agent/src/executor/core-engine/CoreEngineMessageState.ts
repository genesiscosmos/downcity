/**
 * CoreEngine 模型消息运行态。
 *
 * 关键点（中文）
 * - CoreEngine 同时维护 session 语义消息与模型消息。
 * - 新增 user 消息可优先做增量转换，失败时再回退为全量重算。
 * - assistant UI 消息只需要进入 session 语义基线；模型侧使用 SDK 返回的 response messages。
 */

import type { ModelMessage, Tool } from "ai";
import type { SessionRecordV1 } from "@/executor/types/SessionRecords.js";
import {
  pickMergedUserMessages,
  toModelMessages,
} from "@executor/messages/SessionMessageCodec.js";

/**
 * CoreEngine 单轮执行期间的消息基线。
 */
export class CoreEngineMessageState {
  /**
   * 当前运行时 session 语义消息。
   */
  private sessionMessages: SessionRecordV1[];

  /**
   * 当前模型侧消息基线。
   */
  private currentModelMessages: ModelMessage[];

  /**
   * 当前轮可用工具集合。
   */
  private readonly tools: Record<string, Tool>;

  /**
   * 当前项目根目录，用于解析历史中的相对路径 file part。
   */
  private readonly project_root?: string;

  private constructor(params: {
    /**
     * 当前运行时 session 语义消息。
     */
    sessionMessages: SessionRecordV1[];
    /**
     * 当前模型侧消息基线。
     */
    modelMessages: ModelMessage[];
    /**
     * 当前轮可用工具集合。
     */
    tools: Record<string, Tool>;
    /**
     * 当前项目根目录。
     */
    project_root?: string;
  }) {
    this.sessionMessages = params.sessionMessages;
    this.currentModelMessages = params.modelMessages;
    this.tools = params.tools;
    this.project_root = params.project_root;
  }

  /**
   * 基于初始 session 消息创建运行态。
   */
  static async create(params: {
    /**
     * 初始 session 语义消息。
     */
    messages: SessionRecordV1[];
    /**
     * 当前轮可用工具集合。
     */
    tools: Record<string, Tool>;
    /**
     * 当前项目根目录。
     */
    project_root?: string;
  }): Promise<CoreEngineMessageState> {
    const sessionMessages = Array.isArray(params.messages)
      ? [...params.messages]
      : [];
    return new CoreEngineMessageState({
      sessionMessages,
      modelMessages: await toModelMessages(
        sessionMessages,
        params.tools,
        params.project_root,
      ),
      tools: params.tools,
      project_root: params.project_root,
    });
  }

  /**
   * 读取当前模型消息。
   */
  get modelMessages(): ModelMessage[] {
    return this.currentModelMessages;
  }

  /**
   * 把 step 间新增的 user 消息并入两份基线。
   */
  async appendMergedUserMessages(
    messages: SessionRecordV1[],
  ): Promise<ModelMessage[]> {
    const mergedMessages = pickMergedUserMessages(messages);
    if (mergedMessages.length === 0) return [];
    return await this.appendSessionMessagesAsModelMessages(mergedMessages);
  }

  /**
   * 追加内部生成的 user nudge 消息。
   */
  async appendUserTextMessage(message: SessionRecordV1): Promise<void> {
    await this.appendSessionMessagesAsModelMessages([message]);
  }

  /**
   * 追加 assistant UI 消息到 session 语义基线。
   */
  appendRuntimeSessionMessage(message: SessionRecordV1): void {
    this.sessionMessages = [...this.sessionMessages, message];
  }

  /**
   * 追加 SDK 返回的模型 response messages。
   */
  appendModelMessages(messages: ModelMessage[]): void {
    if (!Array.isArray(messages) || messages.length === 0) return;
    this.currentModelMessages = [...this.currentModelMessages, ...messages];
  }

  /**
   * 原子替换当前模型侧消息基线。
   *
   * 关键点（中文）：compact 只替换 Provider 后续可见的 ModelMessage，
   * Session 语义消息与持久化历史仍保持完整，等待 turn 收口后再单独归档。
   */
  replace_model_messages(messages: ModelMessage[]): void {
    this.currentModelMessages = Array.isArray(messages) ? [...messages] : [];
  }

  /**
   * 使用 canonical records 原子替换两份消息基线。
   *
   * 关键点（中文）
   * - 显式 compact 会重写持久化历史，旧的 SessionRecord 与 ModelMessage 必须同时失效。
   * - tools 使用当前 step 的执行视图，避免配置 command 生效后仍按旧工具解码历史。
   */
  async replace_session_messages(
    messages: SessionRecordV1[],
    tools: Record<string, Tool>,
  ): Promise<void> {
    this.sessionMessages = Array.isArray(messages) ? [...messages] : [];
    this.currentModelMessages = await toModelMessages(
      this.sessionMessages,
      tools,
      this.project_root,
    );
  }

  private async appendSessionMessagesAsModelMessages(
    messages: SessionRecordV1[],
  ): Promise<ModelMessage[]> {
    this.sessionMessages = [...this.sessionMessages, ...messages];
    const modelMessages = await toModelMessages(
      messages,
      this.tools,
      this.project_root,
    );
    if (modelMessages.length > 0) {
      this.currentModelMessages = [...this.currentModelMessages, ...modelMessages];
      return modelMessages;
    }
    this.currentModelMessages = await toModelMessages(
      this.sessionMessages,
      this.tools,
      this.project_root,
    );
    return [];
  }
}
