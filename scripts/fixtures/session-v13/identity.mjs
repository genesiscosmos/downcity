/** 冻结的 v13 协议，仅供离线迁移；不得作为当前 SDK 运行实现。 */
/**
 * Session 永久身份规则：入口规范化为小写，新会话使用 UUIDv4。
 * ID 只负责唯一标识；时间与 fork 来源由 Session 元数据和历史保存。
 */
import { randomUUID as random_uuid } from "node:crypto";

/** 目标格式只接受规范 UUIDv4；旧格式身份必须由显式离线映射转换。 */
export function assert_session_id(session_id        )       {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(session_id)) {
    throw new Error("session_storage_address_invalid");
  }
}

/** 将外部 Session 标识转换为唯一的小写形式；空值由调用入口负责校验。 */
export function normalize_session_id(input        )         {
  return String(input || "").trim().toLowerCase();
}

/** 分配新 UUID；存在性检查由集合提供，数据库唯一约束仍是提交时的最终判断。 */
export async function allocate_session_id(
  is_taken                                          ,
)                  {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const session_id = random_uuid();
    if (!(await is_taken(session_id))) return session_id;
  }
  throw new Error("Unable to allocate a unique Session ID after 100 attempts");
}

/** 生成永久 UUIDv4；独立 Session 与集合、主会话共享同一生成规则。 */
export function generate_session_id()         {
  return random_uuid();
}
