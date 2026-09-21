/**
 * Chat Composer Tiptap 文档的 canonical 内容投影。
 *
 * Renderer 负责维护编辑文档，Main 负责提交 Session；两端共同使用本模块把
 * 支持的编辑器结构序列化为 Markdown、引用与附件，避免格式规则在 IPC 两侧漂移。
 *
 * ## 代码块为什么在序列化里单独成一支
 *
 * 代码块是唯一「内容不能转义」的结构。曾经它落进普通段落的路径，于是代码里的
 * `*`、`_`、`$`、`~`、`|` 全被写成反斜杠形式，每行之间还被插入空行，
 * 模型收到的不再是代码。代码体必须原样送达，围栏长度必须按内容自适应。
 */

import type { JSONContent } from "@tiptap/core";
import type { JsonValue } from "@downcity/agent";
import type { ChatComposerContextPart, ChatComposerDataPart, ChatComposerFilePart, ChatComposerPart, ChatComposerProjectionOptions } from "../types/ChatComposer";
import { read_chat_composer_code_language, serialize_chat_composer_code_block } from "./chatComposerCodeFence.ts";

/** 引用节点进入 Session Context 时使用的稳定语义标签。 */
const CHAT_REFERENCE_CONTEXT_TAG = "reference" as const;

/** 累积 Markdown 正文，并在原子节点边界生成有序 parts。 */
class ChatComposerProjectionWriter {
  /** 已完成的有序内容。 */
  private readonly parts: ChatComposerPart[] = [];
  /** 当前原子节点之前尚未提交的 Markdown。 */
  private pending_text = "";
  /** 当前 Markdown 是否包含真实文本，而不只是列表 marker 或块间距。 */
  private pending_has_content = false;

  /** 追加来自 Tiptap 文本节点的用户内容。 */
  append_content(text: string): void {
    this.pending_text += text;
    if (text) this.pending_has_content = true;
  }

  /** 追加只负责表达结构的 Markdown 片段。 */
  append_structure(text: string): void {
    this.pending_text += text;
  }

  /** 在原始位置提交一个引用、附件或结构化数据。 */
  append_atom(part: ChatComposerContextPart | ChatComposerFilePart | ChatComposerDataPart): void {
    this.flush_text();
    this.parts.push(part);
  }

  /** 完成投影并返回原始顺序的内容。 */
  finish(): ChatComposerPart[] {
    this.flush_text();
    return this.parts;
  }

  /** 提交一个非空 Markdown 正文 part。 */
  private flush_text(): void {
    const text = this.pending_text.trim();
    const has_content = this.pending_has_content;
    this.pending_text = "";
    this.pending_has_content = false;
    // 原子节点位于空列表项开头时，不能把孤立的列表 marker 当成用户正文。
    if (!text || !has_content) return;
    this.parts.push({ type: "text", text });
  }
}

/** 把完整 Tiptap Chat Composer 文档投影成有序内容。 */
export function project_chat_composer(document: JSONContent, options: ChatComposerProjectionOptions = {}): ChatComposerPart[] {
  if (!document || document.type !== "doc" || !Array.isArray(document.content)) {
    throw new Error("chat input must be a Tiptap document");
  }
  const writer = new ChatComposerProjectionWriter();
  write_blocks(document.content, writer, options);
  return writer.finish();
}

/** 按 Markdown 块边界序列化一组顶层节点。 */
function write_blocks(nodes: JSONContent[], writer: ChatComposerProjectionWriter, options: ChatComposerProjectionOptions): void {
  nodes.forEach((node, index) => {
    if (index > 0) writer.append_structure("\n\n");
    write_block(node, writer, options);
  });
}

/** 序列化一个受 Chat Composer 支持的块节点。 */
function write_block(node: JSONContent, writer: ChatComposerProjectionWriter, options: ChatComposerProjectionOptions): void {
  if (node.type === "paragraph") {
    write_inline_nodes(node.content || [], writer, "", options);
    return;
  }
  if (node.type === "codeBlock") {
    /*
     * 代码体走 `append_content` 而不是 `append_structure`：前者会标记「这里有真实内容」，
     * 后者不会。若误用后者，只有代码块的消息会在 `flush_text` 里被判成空正文而整块丢弃。
     *
     * 空围栏（只有三个反引号、没有代码）不产生任何内容，也不应被当成可发送的正文；
     * 这里直接跳过，与 `is_chat_composer_empty` 的判空口径保持一致。
     */
    const code = (node.content || []).map((child) => String(child.text ?? "")).join("");
    if (!code.trim()) return;
    writer.append_content(serialize_chat_composer_code_block(read_chat_composer_code_language(node.attrs), code));
    return;
  }
  if (node.type === "bulletList" || node.type === "orderedList") {
    write_list(node, writer, "", options);
    return;
  }
  // 未声明为用户格式的容器只投影其内容，不凭空引入新 Markdown 语义。
  node.content?.forEach((child) => write_block(child, writer, options));
}

/** 序列化段落中的文本、硬换行与结构化原子节点。 */
function write_inline_nodes(nodes: JSONContent[], writer: ChatComposerProjectionWriter, line_prefix: string, options: ChatComposerProjectionOptions): void {
  nodes.forEach((node) => {
    if (node.type === "text") {
      writer.append_content(serialize_marked_text(node));
      return;
    }
    if (node.type === "hardBreak") {
      writer.append_structure(`  \n${line_prefix}`);
      return;
    }
    if (node.type === "chatReference") {
      const context = String(node.attrs?.text || "");
      const tag = String(node.attrs?.tag || CHAT_REFERENCE_CONTEXT_TAG).trim();
      if (!/^[a-z][a-z0-9_-]*$/iu.test(tag)) throw new Error("context tag is invalid");
      if (context.trim()) writer.append_atom({ type: "context", tag, context });
      return;
    }
    if (node.type === "chatAttachment") {
      const url = String(node.attrs?.data_url || "");
      if (!url.startsWith("data:") && !options.allowed_attachment_urls?.has(url)) {
        throw new Error("attachment must use a data URL or an existing canonical URL");
      }
      writer.append_atom({
        type: "file",
        media_type: String(node.attrs?.media_type || "application/octet-stream"),
        url,
        filename: String(node.attrs?.filename || "attachment"),
      });
      return;
    }
    if (node.type === "chatData") {
      const data_type = String(node.attrs?.data_type || "").trim();
      if (!data_type) throw new Error("data type is required");
      writer.append_atom({
        type: "data",
        data_type,
        data: node.attrs?.data as JsonValue,
        ...(String(node.attrs?.data_id || "").trim() ? { data_id: String(node.attrs?.data_id).trim() } : {}),
      });
      return;
    }
    node.content && write_inline_nodes(node.content, writer, line_prefix, options);
  });
}

/** 序列化有序或无序列表，并保持嵌套层级。 */
function write_list(node: JSONContent, writer: ChatComposerProjectionWriter, indent: string, options: ChatComposerProjectionOptions): void {
  const ordered = node.type === "orderedList";
  const start = Number.isInteger(node.attrs?.start) ? Number(node.attrs?.start) : 1;
  (node.content || []).forEach((item, index) => {
    if (index > 0) writer.append_structure("\n");
    const marker = ordered ? `${start + index}. ` : "- ";
    writer.append_structure(`${indent}${marker}`);
    write_list_item(item, writer, `${indent}${" ".repeat(marker.length)}`, options);
  });
}

/** 序列化一个列表项中的段落和子列表。 */
function write_list_item(node: JSONContent, writer: ChatComposerProjectionWriter, continuation_indent: string, options: ChatComposerProjectionOptions): void {
  (node.content || []).forEach((child, index) => {
    if (child.type === "paragraph") {
      if (index > 0) writer.append_structure(`\n\n${continuation_indent}`);
      write_inline_nodes(child.content || [], writer, continuation_indent, options);
      return;
    }
    if (child.type === "bulletList" || child.type === "orderedList") {
      writer.append_structure("\n");
      write_list(child, writer, continuation_indent, options);
      return;
    }
    child.content?.forEach((nested) => write_block(nested, writer, options));
  });
}

/** 把一个 Tiptap 文本节点的 marks 显式编码为 Markdown。 */
function serialize_marked_text(node: JSONContent): string {
  const source = String(node.text || "");
  const leading_space = source.match(/^\s*/)?.[0] || "";
  const trailing_space = source.match(/\s*$/)?.[0] || "";
  const content = source.slice(leading_space.length, source.length - trailing_space.length);
  if (!content) return escape_markdown_text(source);

  const marks = node.marks || [];
  const code_mark = marks.find((mark) => mark.type === "code");
  let output = code_mark ? serialize_inline_code(content) : escape_markdown_text(content);
  if (!code_mark) {
    marks.forEach((mark) => {
      if (mark.type === "bold") output = `**${output}**`;
      else if (mark.type === "italic") output = `*${output}*`;
      else if (mark.type === "strike") output = `~~${output}~~`;
      else if (mark.type === "underline") output = `<ins>${output}</ins>`;
      else if (mark.type === "link") output = `[${output}](${escape_link_destination(String(mark.attrs?.href || ""))})`;
    });
  }
  return `${escape_markdown_text(leading_space)}${output}${escape_markdown_text(trailing_space)}`;
}

/** 转义会让普通输入被 Markdown 重新解释的字符与行首结构。 */
function escape_markdown_text(text: string): string {
  return text
    .replace(/&(?=(?:#\d+|#x[\da-f]+|[a-z][\da-z]+);)/gi, "&amp;")
    .replace(/([\\`*_[\]{}<>~|$])/g, "\\$1")
    .replace(/(^|\n)(\s*)(?=(?:-{3,}|={2,})\s*(?:\n|$))/g, "$1$2\\")
    .replace(/(^|\n)(\s*)([>#])/g, "$1$2\\$3")
    .replace(/(^|\n)(\s*)([-+])(?=\s)/g, "$1$2\\$3")
    .replace(/(^|\n)(\s*)(\d+)\.(?=\s)/g, "$1$2$3\\.");
}

/** 使用足够长的反引号边界保留 inline code 原文。 */
function serialize_inline_code(text: string): string {
  const longest_fence = Math.max(0, ...Array.from(text.matchAll(/`+/g), (match) => match[0].length));
  const fence = "`".repeat(longest_fence + 1);
  const padded = text.startsWith("`") || text.endsWith("`") ? ` ${text} ` : text;
  return `${fence}${padded}${fence}`;
}

/** 转义 Markdown link destination 中会改变边界的字符。 */
function escape_link_destination(href: string): string {
  return href.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)").replace(/\s/g, "%20");
}
