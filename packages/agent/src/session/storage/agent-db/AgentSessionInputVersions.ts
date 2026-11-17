/**
 * canonical 模型输入版本的只读投影。
 *
 * 在存储拥有者的一次读事务中逐行摘要 Parts，只返回版本和文件引用；不构造完整
 * Message、不把历史正文交给 Electron main。无需派生表或跨请求缓存，因此内容更新、
 * 历史截断、导入和归档始终读取当前数据库事实。文件库由 Worker 执行，内存库遵循
 * 其唯一拥有者调度；摘要计算本身不执行文件访问或改变数据库。
 */
import { createHash as create_hash } from "node:crypto";
import type { AgentSessionDatabase } from "./AgentSessionDatabase.js";
import { AgentSessionCatalog } from "./AgentSessionCatalog.js";
import type { SessionInputVersions, SessionInputMessageVersion } from "@/types/store/SessionInputVersions.js";

/** 收集 canonical 内容中的本地 file 引用，与输入校验的媒体授权范围一致。 */
function collect_attachment_paths(value: unknown, paths: Set<string>): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collect_attachment_paths(item, paths);
    return;
  }
  const item = value as Record<string, unknown>;
  if (item.type === "file" && typeof item.url === "string" && /^(?:\/|[A-Za-z]:[\\/])/.test(item.url)) {
    paths.add(item.url);
  }
  for (const nested of Object.values(item)) collect_attachment_paths(nested, paths);
}

/** 用当前 canonical 内容生成版本，摘要和引用提取都不跨越读事务。 */
export function read_session_input_versions(owner: AgentSessionDatabase, session_id: string): SessionInputVersions {
  return owner.read(database => {
    const record = new AgentSessionCatalog(owner).by_session_id(session_id);
    const messages: SessionInputMessageVersion[] = [];
    const paths = new Set<string>();
    let current: SessionInputMessageVersion | undefined;
    let has_pending_interactions = false;
    const rows = database.prepare(`SELECT p.message_id, p.part_id, p.sequence, p.step_id, p.type, p.content
      FROM message_parts AS p JOIN messages AS m USING(session_key, message_id)
      WHERE p.session_key = ? AND p.type NOT IN ('error', 'data')
      ORDER BY m.sequence, p.sequence`).iterate(record.session_key);
    for (const row of rows) {
      const message_id = String(row.message_id);
      const part_id = String(row.part_id);
      const type = String(row.type);
      const content = String(row.content);
      if (type !== "action") {
        if (current?.message_id !== message_id) {
          current = { message_id, parts: [] };
          messages.push(current);
        }
        // 元信息使用 JSON 数组消除拼接歧义；正文直接送入摘要，避免再次 JSON 编码。
        const sha256 = create_hash("sha256")
          .update(JSON.stringify([part_id, row.sequence, row.step_id, type]))
          .update("\0").update(content).digest("hex");
        current.parts.push({ part_id, sha256 });
      }
      // 文本/推理没有结构化子内容；其余类型均递归检查，包含 power.data 中的文件。
      if (type !== "text" && type !== "reasoning") {
        const parsed = JSON.parse(content) as Record<string, unknown>;
        collect_attachment_paths({ ...parsed, type }, paths);
        if (type === "tool" && Array.isArray(parsed.interactions)
          && parsed.interactions.some(item => item && typeof item === "object" && item.status === "pending")) {
          has_pending_interactions = true;
        }
      }
    }
    return { messages, attachment_paths: [...paths], has_pending_interactions };
  });
}
