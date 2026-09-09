/**
 * Agent 本地运行数据与 Session 路径规则。
 *
 * 关键点（中文）
 * - 调用方已经把文件能力限制在当前 Agent 的私有数据根。
 * - Session 在 Agent 内使用稳定且唯一的 session_id 定位。
 * - 本模块只拼接作用域内的相对领域路径，不解析用户级数据根。
 */

import path from "node:path";
import { normalize_session_origin_type } from "@downcity/type";

/** 把标识转换为安全、可逆的单层目录名。 */
function encode_path_segment(input: string): string {
  // 关键点（中文）：只保留小写安全字符，避免大小写不敏感文件系统碰撞和相对目录语义。
  let encoded = [...Buffer.from(input, "utf8")]
    .map((byte) =>
      (byte >= 97 && byte <= 122)
      || (byte >= 48 && byte <= 57)
      || byte === 45
      || byte === 95
      || byte === 126
        ? String.fromCharCode(byte)
        : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`
    )
    .join("");
  // Windows 保留设备名不能直接作为目录名；编码首字符后仍可由 decodeURIComponent 无损恢复。
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu.test(encoded)) {
    encoded = `%${encoded.codePointAt(0)?.toString(16).toUpperCase().padStart(2, "0")}${encoded.slice(1)}`;
  }
  return encoded;
}

/** 把来源类型转换为安全、确定的单层目录名。 */
function encode_origin_type(origin_type: string): string {
  return encode_path_segment(normalize_session_origin_type(origin_type));
}

/** 返回全部活动 Session 来源分区的根目录。 */
export function get_agent_session_origins_path(storage_root_path: string): string {
  return path.join(path.resolve(storage_root_path), "sessions");
}

/** 返回全部归档 Session 来源分区的根目录。 */
export function get_agent_archived_session_origins_path(storage_root_path: string): string {
  return path.join(path.resolve(storage_root_path), "archived-sessions");
}

/** 返回指定来源的活动 Session 集合目录。 */
export function get_agent_sessions_path(
  storage_root_path: string,
  origin_type: string,
): string {
  return path.join(get_agent_session_origins_path(storage_root_path), encode_origin_type(origin_type));
}

/** 返回指定来源的归档 Session 集合目录。 */
export function get_agent_archived_sessions_path(
  storage_root_path: string,
  origin_type: string,
): string {
  return path.join(get_agent_archived_session_origins_path(storage_root_path), encode_origin_type(origin_type));
}

/** 返回单个活动 Session 目录。 */
export function get_agent_session_path(
  storage_root_path: string,
  origin_type: string,
  session_id: string,
): string {
  return path.join(
    get_agent_sessions_path(storage_root_path, origin_type),
    encode_path_segment(String(session_id || "").trim()),
  );
}

/** 返回单个活动 Session 的 SQLite 数据库路径。 */
export function get_agent_session_database_path(
  storage_root_path: string,
  origin_type: string,
  session_id: string,
): string {
  return path.join(
    get_agent_session_path(storage_root_path, origin_type, session_id),
    "session.db",
  );
}

/** 返回单个归档 Session 目录。 */
export function get_agent_archived_session_path(
  storage_root_path: string,
  origin_type: string,
  session_id: string,
): string {
  return path.join(
    get_agent_archived_sessions_path(storage_root_path, origin_type),
    encode_path_segment(String(session_id || "").trim()),
  );
}

/** 返回单个归档 Session 的 SQLite 数据库路径。 */
export function get_agent_archived_session_database_path(
  storage_root_path: string,
  origin_type: string,
  session_id: string,
): string {
  return path.join(
    get_agent_archived_session_path(storage_root_path, origin_type, session_id),
    "session.db",
  );
}

/** 返回单个 Session 的附件目录。 */
export function get_agent_session_attachments_path(
  storage_root_path: string,
  origin_type: string,
  session_id: string,
): string {
  return path.join(
    get_agent_session_path(storage_root_path, origin_type, session_id),
    "attachments",
  );
}
