/**
 * v13 Session 创建事实编码：type/kind 各自存列，relations 仅保存派生和群组事实。
 * 所有读取恢复同一扁平领域对象，避免 SQL 与内存各自推断创建关系。
 */
import { normalize_session_descriptor, type SessionDescriptor } from "@downcity/type";
import type { AgentSessionRecord } from "@/types/store/AgentSessionDatabase.js";

/** 编码规范化后的关系事实，禁止复制 Session 运行对象或配置。 */
export function encode_session_relations(input: SessionDescriptor): string {
  const { type: _type, kind: _kind, ...relations } = normalize_session_descriptor(input);
  return JSON.stringify(relations);
}

/** 恢复正式 v13 的独立类型列与关系 JSON；历史格式由离线转换处理。 */
export function decode_session_record(input: AgentSessionRecord): SessionDescriptor {
  const relations: unknown = JSON.parse(input.relations);
  if (!relations || typeof relations !== "object" || Array.isArray(relations)
    || "type" in relations || "kind" in relations) throw new Error("session_relations_invalid");
  return normalize_session_descriptor({ ...relations, type: input.type, kind: input.kind } as SessionDescriptor);
}
