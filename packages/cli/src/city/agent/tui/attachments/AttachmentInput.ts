/**
 * city agent chat TUI 附件输入辅助函数。
 *
 * slash command 只负责接收路径，本模块负责校验并生成统一的 `<file>` 标签。
 */

import fs from "node:fs/promises";
import path from "node:path";
import { render_chat_message_file_tag } from "@downcity/agent";
import type { ChatAttachmentTagBuildResult } from "@/city/types/ChatAttachment.js";

/** 解析支持引号的路径列表。 */
export function parse_attachment_paths(input: string): string[] {
  const paths: string[] = [];
  const pattern = /(?:^|\s)(?:"([^"\\]*(?:\\.[^"\\]*)*)"|'([^']*)'|(\S+))/g;
  for (const match of input.matchAll(pattern)) {
    const value = match[1] ?? match[2] ?? match[3] ?? "";
    const normalized = value.replace(/\\([\\"'])/g, "$1").trim();
    if (normalized) paths.push(normalized);
  }
  return paths;
}

/** 校验路径并转换成当前工作目录可引用的附件标签。 */
export async function build_attachment_tags(
  input: string,
): Promise<ChatAttachmentTagBuildResult> {
  const paths = parse_attachment_paths(input);
  const tags: string[] = [];
  const errors: string[] = [];
  for (const raw_path of paths) {
    const absolute_path = path.resolve(raw_path);
    const stat = await fs.stat(absolute_path).catch(() => null);
    if (!stat?.isFile()) {
      errors.push(`File not found: ${raw_path}`);
      continue;
    }
    const extension = path.extname(absolute_path).toLowerCase();
    const type = /\.(png|jpe?g|gif|webp|bmp|svg)$/.test(extension)
      ? "photo"
      : /\.(mp3|wav|m4a|ogg|flac)$/.test(extension)
        ? "audio"
        : /\.(mp4|mov|webm|mkv)$/.test(extension)
          ? "video"
          : "document";
    tags.push(render_chat_message_file_tag({ type, path: absolute_path }));
  }
  if (paths.length === 0) errors.push("Usage: /attach <path> [<path> ...]");
  return { tags, errors };
}
