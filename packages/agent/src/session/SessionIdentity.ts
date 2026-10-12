/**
 * Session 身份规则：入口统一小写，自动标识使用 12 位无歧义随机字符。
 * ID 只负责唯一标识；时间与 fork 来源由 Session 元数据和历史保存。
 */
import { customAlphabet } from "nanoid";

/** 排除 0/o、1/i/l，便于人工读取；12 位提供约 58 位随机空间。 */
const create_random_id = customAlphabet("23456789abcdefghjkmnpqrstuvwxyz", 12);

/** 将外部 Session 标识转换为唯一的小写形式；空值由调用入口负责校验。 */
export function normalize_session_id(input: string): string {
  return String(input || "").trim().toLowerCase();
}

/** 分配未被占用的短 ID；存在性检查由 Session 集合提供。 */
export async function allocate_session_id(
  is_taken: (session_id: string) => Promise<boolean>,
): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const session_id = create_random_id();
    if (!(await is_taken(session_id))) return session_id;
  }
  throw new Error("Unable to allocate a unique Session ID after 100 attempts");
}

/** 生成短 ID；独立构造的 Session 可由宿主传入具有碰撞检查的分配器。 */
export function generate_session_id(): string {
  return create_random_id();
}
