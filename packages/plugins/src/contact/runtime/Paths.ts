/**
 * contact plugin runtime 路径规则。
 *
 * 关键点（中文）
 * - 所有 contact 运行时状态都收敛在 `.downcity/contact`。
 * - 每个 contact 一个目录；每条 inbox share 一个目录。
 */

import path from "node:path";

function cleanSegment(input: string, label: string): string {
  const value = String(input || "").trim();
  if (!/^[a-zA-Z0-9._-]+$/.test(value)) {
    throw new Error(`Invalid ${label}: ${input}`);
  }
  if (value === "." || value === ".." || value.includes("..")) {
    throw new Error(`Invalid ${label}: ${input}`);
  }
  return value;
}

/**
 * contact 根目录。
 */
export function getContactRootPath(project_root: string): string {
  return path.join(project_root, ".downcity", "contact");
}

/**
 * contacts 根目录。
 */
export function getContactsRootPath(project_root: string): string {
  return path.join(getContactRootPath(project_root), "contacts");
}

/**
 * 单个 contact 目录。
 */
export function getContactDirectoryPath(
  project_root: string,
  contactId: string,
): string {
  return path.join(getContactsRootPath(project_root), cleanSegment(contactId, "contactId"));
}

/**
 * 单个 contact 元信息文件。
 */
export function getContactJsonPath(project_root: string, contactId: string): string {
  return path.join(getContactDirectoryPath(project_root, contactId), "contact.json");
}

/**
 * 单个 contact 的长期对话历史文件。
 */
export function getContactMessagesPath(
  project_root: string,
  contactId: string,
): string {
  return path.join(getContactDirectoryPath(project_root, contactId), "messages.jsonl");
}

/**
 * link 根目录。
 */
export function getContactLinksRootPath(project_root: string): string {
  return path.join(getContactRootPath(project_root), "links");
}

/**
 * 单个 link 记录文件。
 */
export function getContactLinkPath(project_root: string, linkId: string): string {
  return path.join(getContactLinksRootPath(project_root), `${cleanSegment(linkId, "linkId")}.json`);
}

/**
 * inbox 根目录。
 */
export function getContactInboxRootPath(project_root: string): string {
  return path.join(getContactRootPath(project_root), "inbox");
}

/**
 * 单个 inbox share 目录。
 */
export function getContactInboxSharePath(
  project_root: string,
  shareId: string,
): string {
  return path.join(getContactInboxRootPath(project_root), cleanSegment(shareId, "shareId"));
}

/**
 * 单个 inbox share 元信息文件。
 */
export function getContactInboxShareMetaPath(
  project_root: string,
  shareId: string,
): string {
  return path.join(getContactInboxSharePath(project_root, shareId), "meta.json");
}

/**
 * 单个 inbox share payload 文件。
 */
export function getContactInboxSharePayloadPath(
  project_root: string,
  shareId: string,
): string {
  return path.join(getContactInboxSharePath(project_root, shareId), "payload.json");
}

/**
 * 单个 inbox share 文件根目录。
 */
export function getContactInboxShareFilesPath(
  project_root: string,
  shareId: string,
): string {
  return path.join(getContactInboxSharePath(project_root, shareId), "files");
}

/**
 * received 根目录。
 */
export function getContactReceivedRootPath(project_root: string): string {
  return path.join(getContactRootPath(project_root), "received");
}

/**
 * 单个 received share 目录。
 */
export function getContactReceivedSharePath(
  project_root: string,
  shareId: string,
): string {
  return path.join(getContactReceivedRootPath(project_root), cleanSegment(shareId, "shareId"));
}
