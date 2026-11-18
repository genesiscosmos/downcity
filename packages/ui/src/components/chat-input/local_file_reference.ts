/** 本地文件位置引用：只识别独立 file URL，文档保存地址，不读取或复制文件内容。 */
import type { ChatReferenceNodeAttributes } from "../../types/chat-input";

/** 本地文件引用的稳定 Context 标签；发送与历史消息共用同一语义。 */
export const local_file_reference_tag = "local-file-reference";

/** 从标准本地文件 URL 提取的展示与导航信息。 */
export interface LocalFileReference {
  /** 规范化的 file URL，作为引用正文持久化并传给 Agent。 */
  file_url: string;
  /** 解码后的绝对路径，用于完整路径提示；Windows 路径保留盘符。 */
  file_path: string;
  /** 路径的最后一段，用于紧凑文件标签。 */
  filename: string;
}

/** 只接受单独粘贴的本机文件 URL；正文、网络共享、目录和非法编码保留为原文。 */
export function read_local_file_reference(text: string): LocalFileReference | undefined {
  const value = text.trim();
  if (value.length > 4096 || !/^file:\/\/[^\s\\]+$/iu.test(value)) return;
  try {
    const url = new URL(value);
    if (url.protocol !== "file:" || (url.hostname && url.hostname !== "localhost") || url.search || url.hash) return;
    const pathname = decodeURIComponent(url.pathname);
    if (!pathname.startsWith("/") || pathname.startsWith("//") || /[\u0000-\u001f\u007f\\]/u.test(pathname) || /%2f|%5c/iu.test(url.pathname)) return;
    const filename = pathname.split("/").at(-1);
    if (!filename) return;
    const file_path = /^\/[a-z]:\//iu.test(pathname) ? pathname.slice(1) : pathname;
    return { file_url: url.href, file_path, filename };
  } catch { return; }
}

/** 创建现有引用节点，发送时只投影位置，不生成附件或文件内容快照。 */
export function local_file_reference_node(text: string): ChatReferenceNodeAttributes | undefined {
  const file = read_local_file_reference(text);
  return file ? { tag: local_file_reference_tag, text: file.file_url, preview_text: file.filename } : undefined;
}
