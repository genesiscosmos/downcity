/**
 * 持久化存储世代绑定的 HMAC keyset 游标。
 *
 * 过滤条件采用稳定序列化，正文不进入游标。验证输入大小、签名和全部作用域后才
 * 接受排序键；恢复后的 generation/secret 变化会拒绝旧游标，不依赖进程内快照。
 */
import { createHash as create_hash, createHmac as create_hmac, timingSafeEqual as timing_safe_equal } from "node:crypto";
import type { AgentSessionCursorPayload, AgentSessionDatabaseMetadata } from "@/types/store/AgentSessionDatabase.js";
import { AGENT_SESSION_SCHEMA_VERSION } from "./AgentSessionSchema.js";

/** 稳定 JSON 摘要只接受可序列化业务数据，不包含 undefined 占位字段。 */
export function stable_storage_json(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error("session_storage_request_invalid");
    return serialized;
  }
  if (Array.isArray(value)) return `[${value.map(stable_storage_json).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort()
    .map((key) => `${JSON.stringify(key)}:${stable_storage_json(record[key])}`).join(",")}}`;
}

/** 请求与游标过滤条件共用的确定性摘要。 */
export function storage_digest(value: unknown): string {
  return create_hash("sha256").update(stable_storage_json(value)).digest("hex");
}

/** 编码下一页位置；签名密钥只留在数据库拥有者中。 */
export function encode_agent_session_cursor(
  metadata: AgentSessionDatabaseMetadata,
  filter_hash: string,
  updated_at: number,
  session_key: number,
): string {
  const payload: AgentSessionCursorPayload = {
    version: AGENT_SESSION_SCHEMA_VERSION, agent_id: metadata.agent_id,
    generation: metadata.generation, filter_hash, updated_at, session_key,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = create_hmac("sha256", metadata.cursor_secret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

/** 拒绝损坏、伪造、跨 Agent、跨过滤条件和跨恢复世代的游标。 */
export function decode_agent_session_cursor(
  cursor: string, metadata: AgentSessionDatabaseMetadata, filter_hash: string,
): AgentSessionCursorPayload {
  const invalid = () => new Error("session_list_cursor_invalid: restart pagination from the first page");
  if (typeof cursor !== "string" || Buffer.byteLength(cursor) > 4096) throw invalid();
  const match = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/u.exec(cursor);
  if (!match) throw invalid();
  const [, body, signature] = match;
  const expected = create_hmac("sha256", metadata.cursor_secret).update(body).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timing_safe_equal(actual, expected)) throw invalid();
  let payload: AgentSessionCursorPayload;
  try { payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as AgentSessionCursorPayload; }
  catch { throw invalid(); }
  if (!payload || payload.version !== AGENT_SESSION_SCHEMA_VERSION || payload.agent_id !== metadata.agent_id
    || payload.generation !== metadata.generation || payload.filter_hash !== filter_hash
    || !Number.isSafeInteger(payload.updated_at) || payload.updated_at < 0
    || !Number.isSafeInteger(payload.session_key) || payload.session_key <= 0) throw invalid();
  return payload;
}
