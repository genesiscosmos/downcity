/**
 * Chat 出站附件本地路径解析。
 *
 * 关键点（中文）
 * - 附件基准由调用方按当前会话声明，Channel 不推断、也不持有 Workspace 概念。
 * - 只接受位于声明根目录内的本地路径，避免模型伪造路径读取任意文件。
 * - Telegram 与飞书共用同一套策略，避免两条链路行为不一致。
 */

import path from "node:path";

/** 判断附件路径是否为远程 URL。 */
export function is_remote_attachment_url(value: unknown): boolean {
  return /^https?:\/\//iu.test(String(value ?? "").trim());
}

/** 解析结果：远程 URL 原样透传，本地路径已完成解析与越界校验。 */
export interface ResolvedChatAttachment {
  /** 是否为远程 URL。 */
  is_url: boolean;
  /** 远程 URL 原文，或通过校验的本地绝对路径。 */
  path: string;
}

/**
 * 解析并校验一个出站附件目标。
 *
 * 说明（中文）
 * - 远程 URL 不参与本地路径规则，原样返回并交由各平台自行处理。
 * - 本地路径按声明根目录的首项作为相对路径基准，并必须落在任一允许根目录内。
 * - 未声明根目录时回退到 `fallback_root`，保持既有调用方行为不变。
 */
export function resolve_chat_attachment_target(input: {
  /** 附件路径或 URL 原文。 */
  path_or_url: unknown;
  /** 调用方声明的允许根目录；为空时使用 `fallback_root`。 */
  roots?: readonly (string | undefined)[];
  /** 未声明根目录时的回退基准。 */
  fallback_root: string;
}): ResolvedChatAttachment {
  const raw = String(input.path_or_url ?? "").trim();
  if (!raw) throw new Error("Attachment path is empty");
  if (is_remote_attachment_url(raw)) return { is_url: true, path: raw };

  const declared = normalize_attachment_roots(input.roots);
  const allowed_roots = declared.length > 0
    ? declared
    : normalize_attachment_roots([input.fallback_root]);
  const base_root = allowed_roots[0] ?? path.resolve(input.fallback_root);
  const resolved = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(base_root, raw);
  const is_allowed = allowed_roots.some(
    (root) => resolved === root || resolved.startsWith(root + path.sep),
  );
  if (!is_allowed) {
    throw new Error(`Attachment path is outside the allowed roots: ${raw}`);
  }
  return { is_url: false, path: resolved };
}

/** 归一化根目录列表：去空、去重并转成绝对路径。 */
function normalize_attachment_roots(values: readonly (string | undefined)[] | undefined): string[] {
  if (!Array.isArray(values)) return [];
  const normalized = values
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .map((item) => path.resolve(item));
  return [...new Set(normalized)];
}
