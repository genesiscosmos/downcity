/**
 * lookup 的 canonical 只读入口。宿主注入当前 Agent 的 SessionStore，沿用同 Agent
 * 会话读取权限，不恢复执行器。精确 sequence 查询显式包含 internal 消息；归档仍可读取。
 * 分支优先使用本地复制事实，且必须匹配原始结果摘要，禁止按 tool_call_id 猜测结果。
 */
import type { ModelJsonValue, SessionMessage } from "@downcity/type";
import type { SessionStorage } from "@/types/store/SessionStorage.js";
import type { SessionReadView } from "@/types/store/SessionReadView.js";
import { parse_result_ref, result_digest, tool_result_value, type ResultSnapshot } from "./ResultReference.js";
import { read_result_page } from "./ResultDisclosure.js";

/** 通用 lookup 参数；没有任何业务执行能力。 */
export interface ResultLookupInput {
  /** 框架先前返回的不可变结果引用。 */
  result_ref: string;
  /** 原样传回的页游标，省略时从原文开头读取。 */
  cursor?: string;
  /** 本页最多读取的行数，默认 100，上限 200。 */
  limit?: number;
}

/** 当前宿主会话拥有的只读 lookup 能力。 */
export type ResultLookup = (input: ResultLookupInput) => Promise<ModelJsonValue>;

/** 查找精确 Part 并验证快照，未完成或已变更结果不可读。 */
function read_snapshot(message: SessionMessage | null | undefined, location: ResultSnapshot, category?: string, copied_ref?: string, storage_id?: string): ModelJsonValue | undefined {
  if (message?.role !== "agent") return undefined;
  const part = message.parts.find((item) => item.part_id === location.part_id);
  if (part?.type !== "tool") return undefined;
  const same_source = message.session_id === location.session_id && message.message_id === location.message_id
    && (!location.category || location.category === category) && (!location.storage_id || location.storage_id === storage_id);
  if (!same_source && (!copied_ref || part.result_ref !== copied_ref)) return undefined;
  if (part.state !== "completed" && part.state !== "failed") throw new Error("result_not_completed");
  const value = tool_result_value(part);
  if (result_digest(value) !== location.digest) throw new Error("result_snapshot_changed");
  return value;
}

/** 在已授权宿主边界中读取，不将引用当授权，不触发操作或 UI 投递。 */
export async function lookup_result(input: ResultLookupInput, local: SessionStorage,
  read_session?: (session_id: string, category: string, storage_id?: string) => Promise<SessionReadView>): Promise<ModelJsonValue> {
  try {
    const location = parse_result_ref(input.result_ref);
    const copied = await local.read_message(location.message_id) ?? await local.read_part_message(location.part_id);
    const local_value = read_snapshot(copied, location, local.origin.category, input.result_ref, local.storage_id);
    if (local_value !== undefined) return read_result_page(local_value, input.result_ref, input.cursor, input.limit);
    if (!read_session) throw new Error("result_unavailable_or_forbidden");
    const matches: ModelJsonValue[] = [];
    for (const category of location.category ? [location.category] : ["work", "chat"]) {
      let view: SessionReadView;
      try { view = await read_session(location.session_id, category, location.storage_id); }
      catch { continue; }
      if (location.storage_id && view.storage_id !== location.storage_id) throw new Error("result_unavailable_or_forbidden");
      const page = await view.messages({ before_sequence: location.message_sequence + 1, limit: 1 });
      const value = read_snapshot(page.items.find((item) => item.sequence === location.message_sequence), location, category, undefined, view.storage_id);
      if (value !== undefined) matches.push(value);
    }
    if (matches.length !== 1) throw new Error("result_unavailable_or_forbidden");
    return read_result_page(matches[0]!, input.result_ref, input.cursor, input.limit);
  } catch (error) {
    // 错误只包含框架分类，不回显引用、历史或存储路径。
    const message = error instanceof Error && /^result_[a-z_]+(?:: expected 1\.\.200)?$/.test(error.message)
      ? error.message : "result_unavailable_or_forbidden";
    return { success: false, error: message };
  }
}
