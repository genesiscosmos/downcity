/** Chat Composer Tiptap 文档的构造、读取与状态判断工具。 */

import type { JSONContent } from "@tiptap/core";
import { project_chat_composer } from "../../../../../common/chat/chatComposerProjection.ts";

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
  let has_content = false;
  walk_chat_composer(document, (node) => {
    if (node.type === "text" && String(node.text || "").trim()) has_content = true;
    if (node.type === "chatAttachment" && String(node.attrs?.data_url || "").trim()) has_content = true;
    if (node.type === "chatReference" && String(node.attrs?.text || "").trim()) has_content = true;
    if (node.type === "chatData" && String(node.attrs?.data_type || "").trim()) has_content = true;
  });
  /*
   * 代码块里的文本通过 text 节点计入 has_content，与序列化口径一致：
   * 投影会跳过「只有围栏、没有代码」的空块，所以空围栏不能算可发送内容。
   * 语言属性不构成内容——否则 `ts` 两个字就能把空代码块变成可发送的消息。
   */
  return !has_content;
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
