/** 跨 Agent 委派/回调引用的只读预检，复用公开浏览能力，覆盖所有活动来源分类。 */
import path from "node:path";
import { AgentSessionBrowser, read_agent_pending_references, has_delivered_session_turn } from "@downcity/agent";
import { ResourceError } from "./ResourceError.js";

/**
 * 删除前读取 canonical 活动来源与未完成消息的结构化路由；不搜索文本正文。
 * 持有 root 写租约时可持续分页；只读离线首页不足以完成检查时明确拒绝。
 */
export async function read_session_agent_references(root_path: string, agent_ids: readonly string[], target_agent_id: string, immutable = false): Promise<Record<string, unknown>[]> {
  const references: Record<string, unknown>[] = [];
  for (const agent_id of agent_ids) {
    const browser = new AgentSessionBrowser({ storage_root_path: path.join(root_path, "agents", agent_id), agent_id, immutable });
    try {
      for (const reference of await read_agent_pending_references(path.join(root_path, "agents", agent_id), agent_id)) {
        if (reference.referenced_agent_id === target_agent_id) references.push({ ...reference });
      }
      for (const category of await browser.categories()) {
        let cursor: string | undefined;
        do {
          const page = await browser.list({ category, limit: 200, ...(cursor ? { cursor } : {}) });
          for (const item of page.items) {
            const view = await browser.get(item.session_id, category);
            if (agent_id !== target_agent_id && contains_agent_reference(view.metadata.origin, target_agent_id)) references.push({ kind: "session_origin", agent_id, category, session_id: item.session_id });
            const interactions = await view.interactions();
            if (agent_id === target_agent_id && interactions.length) references.push({ kind: "pending_interaction", agent_id, category, session_id: item.session_id });
            // callback 在 User Message 中持久化；只检查未终态 Agent 聚合的路由引用。
            const checked_turns = new Map<string, boolean>();
            let before_sequence: number | undefined;
            do {
              const messages = await view.messages({ limit: 200, ...(before_sequence ? { before_sequence } : {}) });
              for (const message of messages.items) {
                if (message.role === "user" && agent_id === target_agent_id && message.turn_id) {
                  let delivered = checked_turns.get(message.turn_id);
                  if (delivered === undefined) { delivered = await has_delivered_session_turn(path.join(root_path, "agents", agent_id), item.session_id, message.turn_id); checked_turns.set(message.turn_id, delivered); }
                  if (!delivered) references.push({ kind: "unsettled_prompt", agent_id, category, session_id: item.session_id, turn_id: message.turn_id });
                }
                if (message.role !== "agent" || message.state !== "streaming") continue;
                if (agent_id === target_agent_id) references.push({ kind: "pending_execution", agent_id, category, session_id: item.session_id });
                else if (contains_agent_reference(message, target_agent_id)) references.push({ kind: "pending_callback", agent_id, category, session_id: item.session_id });
              }
              before_sequence = messages.next_before_sequence;
            } while (before_sequence !== undefined);
          }
          if (immutable && page.has_more) throw new ResourceError("capability_missing", "Offline reference inspection exceeds the first browse page; use a supported host", 5);
          cursor = page.next_cursor;
        } while (cursor);
      }
    } finally { browser.dispose(); }
  }
  return references;
}

/** Workspace 移除保留的活动/归档数量，离线只需首页的 total，无需伪造跨调用游标。 */
export async function count_workspace_sessions(root_path: string, agent_ids: readonly string[], workspace_id: string, immutable = false): Promise<number> {
  let total = 0;
  for (const agent_id of agent_ids) {
    const browser = new AgentSessionBrowser({ storage_root_path: path.join(root_path, "agents", agent_id), agent_id, immutable });
    try {
      for (const archived of [false, true]) for (const category of await browser.categories(archived)) {
        total += (await browser.list({ category, workspace_id, limit: 1 }, archived)).total;
      }
    } finally { browser.dispose(); }
  }
  return total;
}

/** 路由只依据结构化 agent_id，文本和私密 payload 不是引用索引。 */
function contains_agent_reference(value: unknown, agent_id: string): boolean {
  if (Array.isArray(value)) return value.some((item) => contains_agent_reference(item, agent_id));
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, item]) => ["agent_id", "parent_agent_id", "target_agent_id"].includes(key) ? item === agent_id : !["text", "payload", "response", "query", "content"].includes(key) && contains_agent_reference(item, agent_id));
}
