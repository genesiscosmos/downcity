/**
 * contact plugin runtime 路径规则。
 *
 * 关键点（中文）
 * - 所有 contact 运行时状态都收敛在 AgentWorkspace 私有 `contact` 目录。
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
export function getContactRootPath(data_path: string): string {
  return path.join(data_path, "contact");
}

/**
 * contacts 根目录。
 */
export function getContactsRootPath(data_path: string): string {
  return path.join(getContactRootPath(data_path), "contacts");
}

/**
 * 单个 contact 目录。
 */
export function getContactDirectoryPath(
  data_path: string,
  contactId: string,
): string {
  return path.join(getContactsRootPath(data_path), cleanSegment(contactId, "contactId"));
}

/**
 * 单个 contact 元信息文件。
 */
export function getContactJsonPath(data_path: string, contactId: string): string {
  return path.join(getContactDirectoryPath(data_path, contactId), "contact.json");
}

/**
 * 单个 contact 的长期对话历史文件。
 */
export function getContactMessagesPath(
  data_path: string,
  contactId: string,
): string {
  return path.join(getContactDirectoryPath(data_path, contactId), "messages.jsonl");
}

/**
 * link 根目录。
 */
export function getContactLinksRootPath(data_path: string): string {
  return path.join(getContactRootPath(data_path), "links");
}

/**
 * 单个 link 记录文件。
 */
export function getContactLinkPath(data_path: string, linkId: string): string {
  return path.join(getContactLinksRootPath(data_path), `${cleanSegment(linkId, "linkId")}.json`);
}

/**
 * inbox 根目录。
 */
export function getContactInboxRootPath(data_path: string): string {
  return path.join(getContactRootPath(data_path), "inbox");
}

/**
 * 单个 inbox share 目录。
 */
export function getContactInboxSharePath(
  data_path: string,
  shareId: string,
): string {
  return path.join(getContactInboxRootPath(data_path), cleanSegment(shareId, "shareId"));
}

/**
 * 单个 inbox share 元信息文件。
 */
export function getContactInboxShareMetaPath(
  data_path: string,
  shareId: string,
): string {
  return path.join(getContactInboxSharePath(data_path, shareId), "meta.json");
}

/**
 * 单个 inbox share payload 文件。
 */
export function getContactInboxSharePayloadPath(
  data_path: string,
  shareId: string,
): string {
  return path.join(getContactInboxSharePath(data_path, shareId), "payload.json");
}

/**
 * 单个 inbox share 文件根目录。
 */
export function getContactInboxShareFilesPath(
  data_path: string,
  shareId: string,
): string {
  return path.join(getContactInboxSharePath(data_path, shareId), "files");
}

/**
 * received 根目录。
 */
export function getContactReceivedRootPath(data_path: string): string {
  return path.join(getContactRootPath(data_path), "received");
}

/**
 * 单个 received share 目录。
 */
export function getContactReceivedSharePath(
  data_path: string,
  shareId: string,
): string {
  return path.join(getContactReceivedRootPath(data_path), cleanSegment(shareId, "shareId"));
}
