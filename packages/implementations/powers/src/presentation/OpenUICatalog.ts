/** OpenUI 纯数据契约：服务端与预览共用校验，不加载 React，不执行描述中的远程能力。 */
import { createParser, tokenize, type LibraryJSONSchema } from "@openuidev/lang-core";
import catalog from "./openui-catalog.json" with { type: "json" };

const parser = createParser(catalog.schema as LibraryJSONSchema);
const forbidden_calls = new Set(["Query", "Mutation", "Run", "OpenUrl"]);
// 通过上游 tokenizer 的类型识别调用，避免把用户文本里的 Query 等词误判为指令。
const component_token = tokenize("Stack([])")[0]!.t;
const function_token = tokenize('@ToAssistant("x")')[0]!.t;
const opening_tokens = new Set(["(", "[", "{"].map((value) => tokenize(value)[0]!.t));
const closing_tokens = new Set([")", "]", "}"].map((value) => tokenize(value)[0]!.t));

/** 对生成中和最终内容统一限制可执行范围和资源用量。 */
export function parse_presentation_content(content: string, complete = true) {
  if (!content.trim() || new TextEncoder().encode(content).byteLength > 240 * 1024) throw new Error("OpenUI content must be non-empty and <= 240 KiB");
  const tokens = tokenize(content);
  if (tokens.length > 30000) throw new Error("OpenUI content exceeds token limit");
  let depth = 0;
  for (const token of tokens) {
    if (typeof token.v === "string" && (token.t === component_token || token.t === function_token) && forbidden_calls.has(token.v)) throw new Error(`Unsupported OpenUI call: ${token.v}`);
    if (typeof token.v === "string" && ["__proto__", "prototype", "constructor"].includes(token.v)) throw new Error("Reserved OpenUI property");
    // 上游分隔符编号由 tokenize 提取，避免字符串内容参与深度统计。
    if (opening_tokens.has(token.t)) depth += 1;
    if (depth > 32) throw new Error("OpenUI nesting exceeds 32");
    if (closing_tokens.has(token.t)) depth -= 1;
  }
  const result = parser.parse(content);
  if (result.queryStatements.length || result.mutationStatements.length) throw new Error("Remote tools are not available in Presentation");
  if (result.meta.statementCount > 200) throw new Error("OpenUI exceeds 200 statements");
  if (result.meta.errors.length) throw new Error(result.meta.errors.slice(0, 5).map((error) => error.message).join("; "));
  if (complete && (!result.root || result.meta.incomplete || result.meta.unresolved.length || result.meta.orphaned.length)) throw new Error("OpenUI content must have a complete root and no unresolved or orphaned statements");
  return result;
}

/** 模型只在 show.content 中使用 OpenUI 语言，其他回复仍使用正常文字。 */
export function presentation_catalog_prompt(): string {
  return `Use presentation.show for rich interactive explanations. Call it where the module belongs, then continue prose. Provide fallback_text and content (OpenUI Lang string). Put content first for progressive previews. No markdown fences inside content. A successful show is already published and remains interactive after this turn ends. Do not call show again to confirm, repair without an error, or wait for user interaction. When the request is satisfied, finish the reply. If multiple distinct modules are requested, publish each missing module once; a single interface containing all requested sections already satisfies the request.\n${catalog.prompt}`;
}
