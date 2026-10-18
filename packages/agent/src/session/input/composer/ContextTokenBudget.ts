/**
 * 摘要文本 token 预算与历史保留策略。
 * 当前 ModelClient 不提供 tokenizer，使用 ASCII 每三字符约一 token、非 ASCII 按码点估算。
 * 这是预算估计，不是模型的精确 token 计数；明确超限仍由执行器缩批处理。
 */

/** 非压缩原始历史的最小估算 token 数，不包含 system、摘要或工具定义。 */
export const MIN_RETAINED_HISTORY_TOKENS = 10_000;

/** 按文本类型估算 token；纯英文、代码与 JSON 不再按每字符一个 token 计费。 */
export function estimate_context_tokens(text: string): number {
  let ascii_count = 0;
  let other_tokens = 0;
  for (const character of text) {
    const point = character.codePointAt(0)!;
    if (point <= 0x7f) ascii_count++;
    else other_tokens += point > 0xffff ? 2 : 1;
  }
  // 连续高密度编码串不按自然语言估算；二进制投影未识别的长串也保留预算余量。
  let encoded_extra = 0;
  for (const match of text.matchAll(/[A-Za-z0-9+/_=\-]{256,}/g)) encoded_extra += match[0].length * 2 / 3;
  return Math.ceil(ascii_count / 3 + other_tokens + encoded_extra);
}

/** 在完整单元边界选择最接近 65% 的前缀，保留区 10k 优先于压缩比例。 */
export function select_compaction_target(texts: readonly string[]): number {
  const sizes = texts.map(estimate_context_tokens);
  const total = sizes.reduce((sum, size) => sum + size, 0);
  if (total <= MIN_RETAINED_HISTORY_TOKENS) return 0;
  const desired = total * 0.65;
  let prefix = 0;
  let best_count = 0;
  let best_distance = Infinity;
  for (let index = 0; index < sizes.length; index++) {
    prefix += sizes[index]!;
    if (total - prefix < MIN_RETAINED_HISTORY_TOKENS) break;
    const distance = Math.abs(prefix - desired);
    if (distance < best_distance) {
      best_count = index + 1;
      best_distance = distance;
    }
  }
  return best_count;
}

/** 按 token 预算查找文本片段终点，且不切断 UTF-16 代理对。 */
export function context_fragment_end(text: string, offset: number, budget: number): number {
  let low = offset;
  let high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (estimate_context_tokens(text.slice(offset, middle)) <= budget) low = middle;
    else high = middle - 1;
  }
  const last = text.charCodeAt(low - 1);
  if (low < text.length && last >= 0xd800 && last <= 0xdbff) low--;
  return low;
}
