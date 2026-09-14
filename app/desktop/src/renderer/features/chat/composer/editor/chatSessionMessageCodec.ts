/** canonical User Message 与可编辑 Chat Composer 文档之间的恢复边界。 */

import type { SessionUserMessagePart } from "@downcity/agent";
import { is_chat_runtime_context_tag } from "@downcity/type";
import type { JSONContent } from "@tiptap/core";
import { marked, type Token, type Tokens } from "marked";

/**
 * 将 canonical User Message parts 按原始顺序恢复为可编辑 Tiptap 文档。
 *
 * 说明（中文）
 * - 运行时注入的 context（如 `info`、`chat-environment`）是上一轮的事实快照，不代表用户输入，
 *   因此不恢复到 Composer，避免用户重新发送时把过期环境原样带回。
 */
export function create_chat_composer_from_user_parts(parts: SessionUserMessagePart[]): JSONContent {
  const content = parts.flatMap((part): JSONContent[] => {
    if (part.type === "text") return markdown_to_chat_blocks(part.text);
    if (part.type === "context" && is_chat_runtime_context_tag(part.tag)) return [];
    if (part.type === "context") return [atom_paragraph({
      type: "chatReference",
      attrs: {
        message_id: "",
        role: "agent",
        tag: part.tag,
        text: part.context,
        preview_text: part.context.replace(/\s+/gu, " ").trim().slice(0, 80),
      },
    })];
    if (part.type === "file") return [atom_paragraph({
      type: "chatAttachment",
      attrs: {
        attachment_id: part.part_id,
        filename: part.filename || "attachment",
        media_type: part.media_type,
        data_url: part.url,
      },
    })];
    return [atom_paragraph({
      type: "chatData",
      attrs: {
        data_type: part.data_type,
        data: part.data,
        data_id: part.data_id || "",
      },
    })];
  });
  return { type: "doc", content: content.length > 0 ? content : [{ type: "paragraph" }] };
}

/** 使用独立段落承载原子节点，保证相邻 canonical parts 不会被重新排序。 */
function atom_paragraph(atom: JSONContent): JSONContent {
  return { type: "paragraph", content: [atom] };
}

/** 将 Chat Composer 支持的 Markdown 子集恢复成对应块节点。 */
function markdown_to_chat_blocks(markdown: string): JSONContent[] {
  return marked.lexer(markdown, { gfm: true }).flatMap(markdown_token_to_blocks);
}

/** 将一个 Markdown 块 token 投影成 Composer 支持的节点。 */
function markdown_token_to_blocks(token: Token): JSONContent[] {
  if (token.type === "space" || token.type === "def") return [];
  if (token.type === "paragraph" || token.type === "text" || token.type === "heading") {
    const tokens = "tokens" in token && token.tokens ? token.tokens : [];
    return [{ type: "paragraph", content: inline_tokens_to_nodes(tokens.length > 0 ? tokens : [{ type: "text", raw: token.raw, text: "text" in token ? token.text : token.raw }]) }];
  }
  if (is_list_token(token)) return [list_token_to_node(token)];
  if (token.type === "blockquote") return (token.tokens || []).flatMap(markdown_token_to_blocks);
  if (token.type === "code") return [{ type: "paragraph", content: [{ type: "text", text: token.text, marks: [{ type: "code" }] }] }];
  if (token.type === "hr") return [{ type: "paragraph", content: [{ type: "text", text: "---" }] }];
  if (token.type === "table") return [{ type: "paragraph", content: [{ type: "text", text: token.raw }] }];
  return [{ type: "paragraph", content: [{ type: "text", text: token.raw }] }];
}

/** 恢复有序或无序列表以及嵌套列表。 */
function list_token_to_node(token: Tokens.List): JSONContent {
  return {
    type: token.ordered ? "orderedList" : "bulletList",
    ...(token.ordered ? { attrs: { start: token.start || 1 } } : {}),
    content: token.items.map((item) => ({
      type: "listItem",
      content: list_item_tokens_to_nodes(item),
    })),
  };
}

/** 将列表项内容恢复为 Tiptap 要求的段落与子列表。 */
function list_item_tokens_to_nodes(item: Tokens.ListItem): JSONContent[] {
  const nodes = item.tokens.flatMap((token): JSONContent[] => {
    if (is_list_token(token)) return [list_token_to_node(token)];
    if (token.type === "text" || token.type === "paragraph") {
      const inline_tokens = token.tokens || [{ type: "text", raw: token.raw, text: token.text }];
      return [{ type: "paragraph", content: inline_tokens_to_nodes(inline_tokens) }];
    }
    return markdown_token_to_blocks(token);
  });
  if (nodes.length === 0) nodes.push({ type: "paragraph" });
  if (item.task) {
    const paragraph = nodes.find((node) => node.type === "paragraph");
    paragraph?.content?.unshift({ type: "text", text: item.checked ? "[x] " : "[ ] " });
  }
  return nodes;
}

/** 将 Markdown inline token 恢复为带 marks 的 Tiptap inline 节点。 */
function inline_tokens_to_nodes(tokens: Token[], inherited_marks: JSONContent["marks"] = []): JSONContent[] {
  const nodes: JSONContent[] = [];
  let active_marks = [...inherited_marks];
  for (const token of tokens) {
    if (token.type === "html" && /^<ins\s*>$/iu.test(token.raw)) {
      active_marks = [...active_marks, { type: "underline" }];
      continue;
    }
    if (token.type === "html" && /^<\/ins\s*>$/iu.test(token.raw)) {
      active_marks = active_marks.filter((mark) => mark.type !== "underline");
      continue;
    }
    if (token.type === "br") {
      nodes.push({ type: "hardBreak" });
      continue;
    }
    if (token.type === "strong" || token.type === "em" || token.type === "del" || token.type === "link") {
      const mark = token.type === "strong"
        ? { type: "bold" }
        : token.type === "em"
          ? { type: "italic" }
          : token.type === "del"
            ? { type: "strike" }
            : { type: "link", attrs: { href: "href" in token ? String(token.href) : "" } };
      nodes.push(...inline_tokens_to_nodes(token.tokens || [], [...active_marks, mark]));
      continue;
    }
    if (token.type === "codespan") {
      append_text_node(nodes, token.text, [...active_marks, { type: "code" }]);
      continue;
    }
    if (token.type === "escape" || token.type === "text") {
      if (token.type === "text" && token.tokens?.length) nodes.push(...inline_tokens_to_nodes(token.tokens, active_marks));
      else append_text_node(nodes, decode_markdown_entities(token.text), active_marks);
      continue;
    }
    if (token.type === "image") {
      append_text_node(nodes, token.text || token.href, active_marks);
      continue;
    }
    append_text_node(nodes, token.raw, active_marks);
  }
  return nodes;
}

/** 排除 marked 扩展 token，确保列表字段完整。 */
function is_list_token(token: Token): token is Tokens.List {
  return token.type === "list" && "items" in token && Array.isArray(token.items);
}

/** 合并 marks 相同的相邻文本，减少编辑文档节点数量。 */
function append_text_node(nodes: JSONContent[], text: string, marks: JSONContent["marks"]): void {
  if (!text) return;
  const previous = nodes.at(-1);
  if (previous?.type === "text" && JSON.stringify(previous.marks || []) === JSON.stringify(marks || [])) {
    previous.text = `${previous.text || ""}${text}`;
    return;
  }
  nodes.push({ type: "text", text, ...(marks?.length ? { marks } : {}) });
}

/** 解码 Composer 序列化过程可能保护的基础 HTML entity。 */
function decode_markdown_entities(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/giu, (entity, name: string) => {
    const normalized = name.toLowerCase();
    if (normalized === "amp") return "&";
    if (normalized === "lt") return "<";
    if (normalized === "gt") return ">";
    if (normalized === "quot") return "\"";
    if (normalized === "apos") return "'";
    const point = normalized.startsWith("#x") ? Number.parseInt(normalized.slice(2), 16) : Number.parseInt(normalized.slice(1), 10);
    return Number.isFinite(point) ? String.fromCodePoint(point) : entity;
  });
}
