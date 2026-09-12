/**
 * Session FIFO 输入队列。
 *
 * 只负责保存 SessionCommand 对象和维护顺序，不识别任何业务输入种类，
 * 也不持有 active Turn。
 */

import type { SessionCommand } from "@/types/session/SessionCommand.js";

/** 单个 Session 的进程内 FIFO。 */
export class SessionQueue {
  private readonly commands: SessionCommand[] = [];

  /** 追加一个可执行 Command 对象。 */
  enqueue_command(command: SessionCommand): void {
    this.commands.push(command);
  }

  /** 当前队列是否包含尚未执行的 Command。 */
  has_command(): boolean {
    return this.commands.length > 0;
  }

  /** 按 FIFO 取出下一条 Command。 */
  take_next(): SessionCommand | undefined {
    return this.commands.shift();
  }

  /** 取出当前全部 Command，供下一个 Step 检查点按顺序执行。 */
  drain(): SessionCommand[] {
    return this.commands.splice(0, this.commands.length);
  }

  /**
   * 只取出当前全部 Maintenance Command，并保留 Prompt 的相对顺序。
   *
   * Turn 收口前用它抽干配置类命令，让这些 Action 与当前 Agent Message 共享同一条
   * Message；Prompt 必须留在队列里由后续 Turn 消费，否则会在没有后续 Step 的情况下
   * 被持久化为 steer 却永远得不到响应。
   */
  drain_maintenance(): SessionCommand[] {
    const drained: SessionCommand[] = [];
    const retained: SessionCommand[] = [];
    for (const command of this.commands) {
      if (command.kind === "maintenance") drained.push(command);
      else retained.push(command);
    }
    this.commands.splice(0, this.commands.length, ...retained);
    return drained;
  }

  /** 把尚未处理的 Command 恢复到队列头部。 */
  restore_front(commands: SessionCommand[]): void {
    this.commands.unshift(...commands);
  }

  /** 调用 Command 自己的取消行为，并保留不可取消的 Command。 */
  cancel(): number {
    let cancelled_count = 0;
    const retained_commands: SessionCommand[] = [];
    for (const command of this.commands) {
      if (command.cancel) {
        command.cancel();
        cancelled_count += 1;
      } else {
        retained_commands.push(command);
      }
    }
    this.commands.splice(0, this.commands.length, ...retained_commands);
    return cancelled_count;
  }
}
