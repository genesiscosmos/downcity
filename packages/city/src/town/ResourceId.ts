/**
 * City 模型 ID 的唯一 codec。原始模型 ID 按 UTF-8 字节无损编码，
 * 名称、地址、账户与模型前缀均不参与推测或 fallback。
 */
import { Buffer } from "node:buffer";

/** codec 解析后的唯一来源。 */
export type TownModelOrigin = {
  /** 独立 Downtown 连接。 */
  kind: "downtown";
  /** 由宿主持久分配且不含冒号的连接标识。 */
  connection_id: string;
  /** 远端声明的完整原始模型 ID。 */
  original_model_id: string;
} | {
  /** 直接 ModelClient 来源。 */
  kind: "client";
  /** 宿主或扩展的稳定条目 ID。 */
  source_id: string;
};

/** 稳定 ID 不能通过 trim 或替换字符修复；错误必须暴露给宿主。 */
export function assert_connection_id(connection_id: string): void {
  if (typeof connection_id !== "string" || !connection_id || connection_id.includes(":") || connection_id !== connection_id.trim()) {
    throw new TypeError("town_invalid_connection_id");
  }
}

/** 保留全部 Unicode 字节，并拒绝不能往返 UTF-8 的孤立 surrogate。 */
function encode_id(value: string): string {
  if (typeof value !== "string" || !value || Buffer.from(value, "utf8").toString("utf8") !== value) {
    throw new TypeError("town_invalid_resource_id");
  }
  return Buffer.from(value, "utf8").toString("base64url");
}

function decode_id(value: string): string {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new TypeError("town_invalid_model_id");
  const result = Buffer.from(value, "base64url").toString("utf8");
  if (encode_id(result) !== value) throw new TypeError("town_invalid_model_id");
  return result;
}

/** Downtown 原始模型 ID 只能通过此函数进入 City 命名空间。 */
export function downtown_model_id(connection_id: string, original_model_id: string): string {
  assert_connection_id(connection_id);
  return `model:downtown:${connection_id}:${encode_id(original_model_id)}`;
}

/** 扩展稳定条目作为来源键，不反解旧 hash，也不篡改底层客户端 ID。 */
export function client_model_id(source_id: string): string {
  return `model:client:${encode_id(source_id)}`;
}

/** 不接受裸 ID 或旧前缀；未知历史引用必须由宿主显式迁移或重选。 */
export function parse_model_id(model_id: string): TownModelOrigin {
  if (typeof model_id !== "string") throw new TypeError("town_invalid_model_id");
  const parts = model_id.split(":");
  if (parts.length === 4 && parts[0] === "model" && parts[1] === "downtown") {
    assert_connection_id(parts[2]!);
    return { kind: "downtown", connection_id: parts[2]!, original_model_id: decode_id(parts[3]!) };
  }
  if (parts.length === 3 && parts[0] === "model" && parts[1] === "client") {
    return { kind: "client", source_id: decode_id(parts[2]!) };
  }
  throw new TypeError("town_model_source_required");
}
