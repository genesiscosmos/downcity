/**
 * Workspace Session Message Store 工厂。
 *
 * 关键点（中文）
 * - 跨 package 调用方只依赖 SessionMessageStore contract，不依赖 JSONL 实现类。
 * - 物理格式由 @downcity/agent 内部选择，后续替换实现不会扩散到 Plugin。
 */

import { JsonlSessionMessageStore } from "@/workspace/store/JsonlSessionMessageStore.js";
import type { JsonlSessionMessageStoreOptions } from "@/types/store/LocalStore.js";
import type { SessionMessageStore } from "@/types/store/SessionDataStore.js";

/** 创建当前默认的本地 Session Message Store。 */
export function create_session_message_store(
  options: JsonlSessionMessageStoreOptions,
): SessionMessageStore {
  return new JsonlSessionMessageStore(options);
}
