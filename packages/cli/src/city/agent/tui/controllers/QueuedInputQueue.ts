/**
 * Agent Chat TUI 的本地输入队列。
 *
 * 关键点（中文）
 * - 仅保存执行中由 Enter 提交的普通消息，不直接调用远端 Session。
 * - 消费端按 FIFO 取得下一条消息；空编辑器的 ↑ 按 LIFO 取回最近消息编辑。
 * - 队列不承载网络状态，远端提交与失败处理由协调器负责。
 */

import type { QueuedInput } from "@/city/agent/tui/types.js";
import { generateTuiId } from "@/city/agent/tui/utils/id.js";

/**
 * 本地排队输入的最小状态容器。
 */
export class QueuedInputQueue {
  private readonly queued_inputs: QueuedInput[] = [];

  /** 当前排队消息数量。 */
  get count(): number {
    return this.queued_inputs.length;
  }

  /** 当前 FIFO 队列快照，仅供渲染读取。 */
  get items(): readonly QueuedInput[] {
    return this.queued_inputs;
  }

  /**
   * 向队尾追加一条已验证的用户输入。
   *
   * @param text 要在后续 Turn 中发送的文本。
   */
  enqueue(text: string): void {
    this.queued_inputs.push({
      id: generateTuiId(),
      text,
    });
  }

  /**
   * 从队首取出最早的输入，供 FIFO 消费。
   *
   * @returns 最早的排队输入；队列为空时返回 undefined。
   */
  take_next(): QueuedInput | undefined {
    return this.queued_inputs.shift();
  }

  /**
   * 取回最近追加的输入，供空编辑器的 ↑ 继续编辑。
   *
   * @returns 最新的排队输入；队列为空时返回 undefined。
   */
  recall_latest(): QueuedInput | undefined {
    return this.queued_inputs.pop();
  }

  /**
   * 清空队列并返回被移除的条目，供调用方展示丢弃提示。
   *
   * @returns 清空前的所有排队输入，顺序保持 FIFO。
   */
  clear(): QueuedInput[] {
    return this.queued_inputs.splice(0, this.queued_inputs.length);
  }
}
