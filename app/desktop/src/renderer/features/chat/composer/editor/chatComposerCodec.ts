/** Chat Composer Tiptap 文档的构造、读取与状态判断工具。 */

import type { JSONContent } from "@tiptap/core";

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
  });
  return !has_content;
}

/** 读取 Chat Input 中的可见文本；可选将引用节点投影成引用块。 */
export function read_chat_composer_text(document: JSONContent, include_references = false): string {
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
    if (node.type === "chatReference") {
      if (!include_references) return;
      const reference = String(node.attrs?.text || "").trim();
      if (reference) {
        if (text.trim() && !text.endsWith("\n")) text += "\n";
        text += `${reference.split("\n").map((line) => `> ${line}`).join("\n")}\n\n`;
      }
      return;
    }
    if (node.type === "chatAttachment") return;
    node.content?.forEach(visit);
    if (node.type === "paragraph") text += "\n";
  };
  visit(document);
  return text.trim();
}

/** 判断 Chat Input 是否包含附件或引用等结构化原子节点。 */
export function has_chat_composer_atoms(document: JSONContent): boolean {
  let has_atoms = false;
  walk_chat_composer(document, (node) => {
    if (node.type === "chatAttachment" || node.type === "chatReference") has_atoms = true;
  });
  return has_atoms;
}

/** 统计 Chat Input 中有效附件与引用节点的数量。 */
export function count_chat_composer_atoms(document: JSONContent): number {
  let count = 0;
  walk_chat_composer(document, (node) => {
    if (node.type === "chatAttachment" && String(node.attrs?.data_url || "").trim()) count += 1;
    if (node.type === "chatReference" && String(node.attrs?.text || "").trim()) count += 1;
  });
  return count;
}

/** 识别只由纯文本构成、应由 Chat Input 本地处理的命令。 */
export function resolve_chat_input_command(document: JSONContent): "compact" | undefined {
  if (has_chat_composer_atoms(document)) return undefined;
  return read_chat_composer_text(document) === "/compact" ? "compact" : undefined;
}

/** 深度遍历一份 Chat Composer 文档。 */
function walk_chat_composer(document: JSONContent, visit: (node: JSONContent) => void): void {
  visit(document);
  document.content?.forEach((node) => walk_chat_composer(node, visit));
}
