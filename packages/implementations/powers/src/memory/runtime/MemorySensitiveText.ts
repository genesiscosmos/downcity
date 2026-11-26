/** Memory 明确凭据模式的统一拒绝守卫；只检查提供的文本，不读取外部数据，也不回显匹配内容。 */

/** 沿用 Memory 的凭据模式，并识别序列化请求中的带引号字段名。不是完整的秘密识别器。 */
const credential_pattern = /\b(?:password|secret|api[_ -]?key|access[_ -]?token)\b["']?\s*[:=]|-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----|\bsk-[a-z0-9_-]{12,}\b/iu;

/** 检查显式凭据形状，不改变或脱敏正文以冒充保存原文。 */
export function contains_memory_credentials(text: string): boolean {
  return credential_pattern.test(text);
}

/** 在内容或来源固化前明确失败；错误不携带原文、匹配值或位置。 */
export function assert_memory_text_safe(text: string): void {
  if (contains_memory_credentials(text)) throw new Error("MEMORY_SENSITIVE_TEXT: explicit credential patterns cannot be persisted in memory content or sources");
}
