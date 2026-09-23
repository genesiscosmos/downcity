/**
 * `SKILL.md` front matter 解析。
 *
 * 关键点（中文）
 * - 只切分 YAML 头部与正文，不解释字段语义。
 * - 不依赖任何外部状态，便于测试与复用。
 */

/**
 * front matter 解析结果。
 */
export interface FrontMatterParseResult {
  /**
   * YAML 头部原文；不存在时为空。
   */
  front_matter_yaml: string | null;
  /**
   * 去掉 front matter 后的正文。
   */
  body: string;
}

/**
 * 切分 Markdown front matter。
 */
export function parse_front_matter(markdown: string): FrontMatterParseResult {
  const text = String(markdown ?? "");
  if (!text.startsWith("---")) return { front_matter_yaml: null, body: text };

  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { front_matter_yaml: null, body: text };

  return {
    front_matter_yaml: match[1] ?? "",
    body: text.slice(match[0].length),
  };
}
