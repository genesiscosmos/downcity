/**
 * 摘要文本 token 预算与历史保留策略。
 * 当前 ModelClient 不提供 tokenizer，ASCII 每三个字符约一 token，非 ASCII 每个 UTF-16 码元约一 token。
 * 这是预算估计，不是模型的精确 token 计数；明确超限仍由执行器缩批处理。
 */

/** 原始历史保留的软目标；请求预算或 Provider 超限时允许低于此值。 */
export const MIN_RETAINED_HISTORY_TOKENS = 10_000;

/** 按文本类型估算 token；纯英文、代码与 JSON 不再按每字符一个 token 计费。 */
export function estimate_context_tokens(text: string): number {
  let ascii_count = 0;
  // 非 ASCII 码点原本按占用的码元数计费，因此只需统计 ASCII，再用总长度减去它。
  for (let index = 0; index < text.length; index++) {
    if (text.charCodeAt(index) <= 0x7f) ascii_count++;
  }
  const other_tokens = text.length - ascii_count;
  // 连续高密度编码串不按自然语言估算；二进制投影未识别的长串也保留预算余量。
  let encoded_extra = 0;
  for (const match of text.matchAll(/[A-Za-z0-9+/_=\-]{256,}/g)) encoded_extra += match[0].length * 2 / 3;
  return Math.ceil(ascii_count / 3 + other_tokens + encoded_extra);
}

/** 在完整单元边界选择接近 65% 的前缀；强制推进时放宽 10k 保留软目标。 */
export function select_compaction_target(texts: readonly string[], force = false): number {
  const sizes = texts.map(estimate_context_tokens);
  const total = sizes.reduce((sum, size) => sum + size, 0);
  if (!force && total <= MIN_RETAINED_HISTORY_TOKENS) return 0;
  const desired = total * 0.65;
  let prefix = 0;
  let best_count = 0;
  let best_distance = Infinity;
  for (let index = 0; index < sizes.length; index++) {
    prefix += sizes[index]!;
    if (!force && total - prefix < MIN_RETAINED_HISTORY_TOKENS) break;
    const distance = Math.abs(prefix - desired);
    if (distance < best_distance) {
      best_count = index + 1;
      best_distance = distance;
    }
  }
  return best_count;
}
