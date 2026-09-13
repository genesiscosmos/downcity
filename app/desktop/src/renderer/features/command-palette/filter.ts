/**
 * Desktop 命令面板的检索与排序。
 *
 * 纯函数：不读 store、不读 document、不建订阅，因此可在 `node --test` 中直接验证，
 * 也保证「相同输入 → 相同输出」，不做任何时间或随机依赖。
 *
 * 唯一与 duobox 参考实现的刻意偏离：duobox 依赖 cmdk 的内置过滤，本模块自带确定性排序，
 * 以便列表顺序可预测、可测试、可解释。
 */

import { command_group_order, type CommandContext, type CommandDefinition, type CommandGroupId, type RankedCommand } from "./types.ts";

/** 结果上限；超出时截断并在面板页脚提示。 */
export const command_result_limit = 200;

/** 子序列匹配的最小 token 长度；过短会把几乎所有命令都匹配上。 */
const subsequence_min_length = 2;

/** 单条命令的匹配档位；数字越小越优先。 */
const match_tier = {
  title_exact: 0,
  title_prefix: 1,
  title_substring: 2,
  keyword_substring: 3,
  title_subsequence: 4,
} as const;

/** 分组标签；调用方传入已翻译文案，本模块不依赖 i18n。 */
export type CommandGroupLabels = Readonly<Partial<Record<CommandGroupId, string>>>;

/**
 * 过滤并排序命令。
 *
 * @param commands 注册表中的全部命令。
 * @param query 用户输入；大小写不敏感，按空白切分为 token 后取 AND 语义。
 * @param context 当前导航上下文；用于求值 `when` 与 `enabled`。
 * @param group_labels 已翻译的分组标签，参与检索但不参与展示。
 */
export function filter_and_rank(
  commands: readonly CommandDefinition[],
  query: string,
  context: CommandContext,
  group_labels: CommandGroupLabels = {},
): readonly RankedCommand[] {
  const tokens = normalize_query(query);
  const ranked: Array<{ command: CommandDefinition; is_enabled: boolean; score: number; group_index: number }> = [];

  for (const command of commands) {
    if (command.when && !command.when(context)) continue;

    const score = tokens.length === 0 ? 0 : score_command(command, tokens, group_labels[command.group]);
    if (score === null) continue;

    ranked.push({
      command,
      is_enabled: command.enabled ? command.enabled(context) : true,
      score,
      group_index: group_index_of(command.group),
    });
  }

  ranked.sort(compare_ranked);

  return ranked.slice(0, command_result_limit).map((entry) => ({
    ...entry.command,
    is_enabled: entry.is_enabled,
  }));
}

/** 规范化查询：小写化、去首尾空白、按连续空白切分；CJK 不分词，整段作为一个 token。 */
export function normalize_query(query: string): readonly string[] {
  return query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
}

/** 排序比较器；末级 title 比较必须存在，否则同分组同 order 的顺序不稳定。 */
function compare_ranked(
  left: { command: CommandDefinition; score: number; group_index: number },
  right: { command: CommandDefinition; score: number; group_index: number },
): number {
  if (left.score !== right.score) return left.score - right.score;
  if (left.group_index !== right.group_index) return left.group_index - right.group_index;
  const order_diff = (left.command.order ?? 0) - (right.command.order ?? 0);
  if (order_diff !== 0) return order_diff;
  return left.command.title.localeCompare(right.command.title);
}

/** 未登记的分组排在最后，避免自定义分组插到固定顺序中间。 */
function group_index_of(group: CommandGroupId): number {
  const index = command_group_order.indexOf(group);
  return index === -1 ? command_group_order.length : index;
}

/**
 * 计算一条命令对全部 token 的匹配档位。
 *
 * 每个 token 都必须命中；整体取最差档位，因此额外的 token 只会让结果更靠后而不会被忽略。
 * 返回 null 表示该命令不匹配。
 */
function score_command(command: CommandDefinition, tokens: readonly string[], group_label?: string): number | null {
  const title = command.title.toLocaleLowerCase();
  const keywords = (command.keywords ?? []).map((keyword) => keyword.toLocaleLowerCase());
  const label = group_label?.toLocaleLowerCase();
  let worst: number = match_tier.title_exact;

  for (const token of tokens) {
    const tier = score_token(token, title, keywords, label);
    if (tier === null) return null;
    if (tier > worst) worst = tier;
  }

  return worst;
}

/** 单个 token 的最佳匹配档位；返回 null 表示不命中。 */
function score_token(token: string, title: string, keywords: readonly string[], label?: string): number | null {
  if (title === token) return match_tier.title_exact;
  if (title.startsWith(token)) return match_tier.title_prefix;
  if (title.includes(token)) return match_tier.title_substring;
  if (keywords.some((keyword) => keyword.includes(token))) return match_tier.keyword_substring;
  if (label?.includes(token)) return match_tier.keyword_substring;
  if (token.length >= subsequence_min_length && is_subsequence(token, title)) return match_tier.title_subsequence;
  return null;
}

/** 判断 needle 的字符是否按顺序出现在 haystack 中（允许跳字符）。 */
function is_subsequence(needle: string, haystack: string): boolean {
  let cursor = 0;
  for (const character of haystack) {
    if (character === needle[cursor]) cursor += 1;
    if (cursor === needle.length) return true;
  }
  return cursor === needle.length;
}
