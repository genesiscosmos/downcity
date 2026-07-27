/**
 * Session FIFO 输入队列。
 *
 * 只负责保存 SessionCommand 对象和维护顺序，不识别任何业务输入种类，
 * 也不持有 active Turn。
 */

import { SessionCommand } from "@/session/SessionCommand.js";

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

  /** 把尚未处理的 Command 恢复到队列头部。 */
  restore_front(commands: SessionCommand[]): void {
    this.commands.unshift(...commands);
  }

  /** 调用 Command 自己的取消行为，并保留不可取消的 Command。 */
  cancel(): number {
    let cancelled_count = 0;
    const retained_commands: SessionCommand[] = [];
    for (const command of this.commands) {
      if (command.cancel()) {
        cancelled_count += 1;
      } else {
        retained_commands.push(command);
      }
    }
    this.commands.splice(0, this.commands.length, ...retained_commands);
    return cancelled_count;
  }
}
