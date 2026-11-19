/**
 * canonical 历史的不可拆分摘要单元。
 *
 * User Message 保持完整；Agent 按 Step 与独立 input 分组。同一 step_id 的首尾跨度
 * 即使夹有无作用域的宿主内容也必须完整保留，避免 checkpoint 留下半组工具调用。
 * 此处只识别单元及终态，写端的稳定水位仍是 streaming 前缀不可变性的唯一授权。
 */
import type { SessionMessage } from "@downcity/type";
import type { StableContextUnit } from "@/types/session/ContextCheckpoint.js";

/** 将单条完整 Message 划分为具有 canonical 末端位置的连续单元。 */
export function group_context_units(message: SessionMessage): StableContextUnit[] {
  const parts = [...message.parts].sort((left, right) => left.sequence - right.sequence);
  if (!parts.length) return [];
  if (message.role === "user") return [{ message, parts, part: parts.at(-1)! }];
  const last_step_index = new Map<string, number>();
  for (const [index, part] of parts.entries()) {
    // input 是独立输入，step_id 仅为因果关联，不把它当作模型输出 Step。
    if (part.type !== "input" && "step_id" in part && part.step_id) last_step_index.set(part.step_id, index);
  }
  const units: StableContextUnit[] = [];
  for (let start = 0; start < parts.length;) {
    let end = start;
    for (let index = start; index <= end; index++) {
      const part = parts[index]!;
      if (part.type !== "input" && "step_id" in part && part.step_id) {
        end = Math.max(end, last_step_index.get(part.step_id)!);
      }
    }
    const unit_parts = parts.slice(start, end + 1);
    units.push({ message, parts: unit_parts, part: unit_parts.at(-1)! });
    start = end + 1;
  }
  return units;
}

/** 未终态的 Tool、Action 或模型文本均阻挡整个单元及其后的前缀。 */
export function is_context_unit_terminal(unit: StableContextUnit): boolean {
  if (unit.message.role === "user") return true;
  return unit.parts.every(part => {
    if (part.type === "tool") return part.state === "completed" || part.state === "failed";
    if (part.type === "action") return part.state === "completed" || part.state === "failed";
    if (part.type === "text" || part.type === "reasoning") return "state" in part && part.state === "done";
    return true;
  });
}

/** 活动尾部本身已被保留；否则为请求保留最后一个 Step/input，纯宿主数据不替代它。 */
export function is_context_request_unit(unit: StableContextUnit): boolean {
  if (unit.message.role === "user") return true;
  return !is_context_unit_terminal(unit)
    || unit.parts.some(part => part.type === "input" || part.type === "tool" || part.type === "text"
      || part.type === "reasoning" || part.type === "view");
}
