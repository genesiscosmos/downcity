/**
 * Session 有序输入队列中的可执行 Command。
 *
 * Command 对象封装一次需要遵守 Session FIFO 与检查点顺序的行为。Queue 只保存
 * 对象和维护顺序，不识别 Prompt、配置、Compact 等业务种类。
 */

import type {
  SessionCommandCompletion,
  SessionCommandOptions,
} from "@/types/session/SessionCommand.js";

/** 一次等待在 Session 检查点执行的 Command。 */
export class SessionCommand {
  private readonly execute_command: SessionCommandOptions["execute"];
  private readonly cancel_command?: SessionCommandOptions["cancel"];
  private readonly completion_info?: SessionCommandOptions["completion"];

  /** @param options 当前 Command 的执行与可选取消行为。 */
  constructor(options: SessionCommandOptions) {
    this.execute_command = options.execute;
    this.cancel_command = options.cancel;
    this.completion_info = options.completion;
  }

  /** 执行当前 Command，并返回成功后需要持久化的完成信息。 */
  async execute(): Promise<SessionCommandCompletion | undefined> {
    await this.execute_command();
    return this.completion_info;
  }

  /**
   * 在 Session stop 时尝试取消当前 Command。
   *
   * @returns true 表示 Command 已取消并应从 Queue 移除；false 表示继续保留。
   */
  cancel(): boolean {
    if (!this.cancel_command) return false;
    this.cancel_command();
    return true;
  }
}
