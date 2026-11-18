/** Chat Composer Tiptap 文档的构造、读取与状态判断工具。 */

import type { JSONContent } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { project_chat_composer } from "../../lib/chat-document-projection";

/** 创建一份可直接交给 Tiptap 的 Chat Input 文档。 */
export function create_chat_composer(text = ""): JSONContent {
  const lines = text.split("\n");
  const content: JSONContent[] = [];
  lines.forEach((line, index) => {
    if (index > 0) content.push({ type: "hardBreak" });
    if (line) content.push({ type: "text", text: line });
  });
  return {
    type: "doc",
    content: [{ type: "paragraph", ...(content.length > 0 ? { content } : {}) }],
  };
}

/** 判断 Chat Input 是否包含可提交的正文、附件或引用。 */
export function is_chat_composer_empty(document: JSONContent | null | undefined): boolean {
  if (!document) return true;
  if (has_chat_composer_content(document.type, document.text, document.attrs)) return false;
  return document.content?.every(is_chat_composer_empty) ?? true;
}

/** 直接检查不可变编辑文档，发现有效内容后停止，不为输入状态导出完整 JSON。 */
export function is_chat_composer_node_empty(document: ProseMirrorNode): boolean {
  if (has_chat_composer_content(document.type.name, document.text, document.attrs)) return false;
  for (let index = 0; index < document.childCount; index += 1) {
    if (!is_chat_composer_node_empty(document.child(index))) return false;
  }
  return true;
}

/** JSON 草稿与编辑文档共用内容口径；空代码块的语言属性不构成可发送正文。 */
function has_chat_composer_content(node_type: string | undefined, text: string | undefined, attrs: JSONContent["attrs"]): boolean {
  switch (node_type) {
    case "text": return Boolean(text?.trim());
    case "chatAttachment": return Boolean(String(attrs?.data_url || "").trim());
    case "chatReference": return Boolean(String(attrs?.text || "").trim());
    case "chatData": return Boolean(String(attrs?.data_type || "").trim());
    default: return false;
  }
}

/** 读取 Chat Input 中的可见文本；可选将引用节点投影成引用块。 */
export function read_chat_composer_text(document: JSONContent, include_references = false): string {
  return project_chat_composer(document).flatMap((part) => {
    if (part.type === "text") return [part.text];
    if (part.type === "context" && include_references) {
      return [part.context.split("\n").map((line) => `> ${line}`).join("\n")];
    }
    return [];
  }).join("\n\n").trim();
}

/** 读取编辑器中直接可见的纯文本，供不解析 Markdown 的队列摘要与纯文本编辑使用。 */
export function read_chat_composer_visible_text(document: JSONContent): string {
  let text = "";
  const visit = (node: JSONContent) => {
    if (node.type === "text") {
      text += String(node.text || "");
      return;
    }
    if (node.type === "hardBreak") {
      text += "\n";
      return;
    }
    if (node.type === "chatAttachment" || node.type === "chatReference" || node.type === "chatData") return;
    node.content?.forEach(visit);
    if (node.type === "paragraph" || node.type === "codeBlock") text += "\n";
  };
  visit(document);
  return text.trim();
}

/** 判断 Chat Input 是否包含附件或引用等结构化原子节点。 */
export function has_chat_composer_atoms(document: JSONContent): boolean {
  let has_atoms = false;
  walk_chat_composer(document, (node) => {
    if (node.type === "chatAttachment" || node.type === "chatReference" || node.type === "chatData") has_atoms = true;
  });
  return has_atoms;
}

/**
 * 判断文档是否包含 textarea 无法无损往返的结构。
 *
 * 代码块必须算在内：队列里的「编辑」是一个单行 textarea，它只能改纯文本，
 * 拿不到围栏与语言。若把它当成可编辑，用户保存后代码块会被压成一行普通文字。
 */
export function has_chat_composer_rich_formatting(document: JSONContent): boolean {
  let has_formatting = false;
  walk_chat_composer(document, (node) => {
    if ((node.marks?.length || 0) > 0 || node.type === "bulletList" || node.type === "orderedList" || node.type === "codeBlock") has_formatting = true;
  });
  return has_formatting;
}

/** 统计 Chat Input 中有效附件与引用节点的数量。 */
export function count_chat_composer_atoms(document: JSONContent): number {
  let count = 0;
  walk_chat_composer(document, (node) => {
    if (node.type === "chatAttachment" && String(node.attrs?.data_url || "").trim()) count += 1;
    if (node.type === "chatReference" && String(node.attrs?.text || "").trim()) count += 1;
    if (node.type === "chatData" && String(node.attrs?.data_type || "").trim()) count += 1;
  });
  return count;
}

/** 深度遍历一份 Chat Composer 文档。 */
function walk_chat_composer(document: JSONContent, visit: (node: JSONContent) => void): void {
  visit(document);
  document.content?.forEach((node) => walk_chat_composer(node, visit));
}
