/**
 * contact 存储。
 *
 * 关键点（中文）
 * - 一个 contact 一个目录，目录内保存 `contact.json` 与 `messages.jsonl`。
 * - 查找 contact 支持 id/name，方便 CLI 使用别名。
 */

import fs from "fs-extra";
import path from "node:path";
import type {
  AgentContact,
  ContactReachability,
  ContactChatMessage,
} from "@/contact/types/Contact.js";
import { hashContactToken, toContactSlug } from "./Token.js";
import {
  getContactDirectoryPath,
  getContactJsonPath,
  getContactMessagesPath,
  getContactsRootPath,
} from "./Paths.js";

function normalizeEndpoint(endpoint: string): string {
  const raw = String(endpoint || "").trim();
  if (!raw) throw new Error("endpoint is required");
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  const url = new URL(withProtocol);
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function isReachability(input: unknown): input is ContactReachability {
  return input === "inbound" || input === "outbound" || input === "bidirectional";
}

function isContactStatus(input: unknown): input is AgentContact["status"] {
  return input === "trusted" || input === "blocked";
}

function normalizeOptionalEndpoint(input: unknown): string | null | undefined {
  if (input === undefined || input === null) return null;
  if (typeof input !== "string") return undefined;
  try {
    return normalizeEndpoint(input);
  } catch {
    return undefined;
  }
}

function normalizeOptionalToken(input: unknown): string | null | undefined {
  if (input === undefined || input === null) return null;
  if (typeof input !== "string") return undefined;
  const value = input.trim();
  return value || null;
}

function normalizeOptionalTimestamp(input: unknown): number | undefined {
  return typeof input === "number" && Number.isFinite(input) ? input : undefined;
}

function inferStoredReachability(params: {
  endpoint: string | null;
  outboundToken: string | null;
  inboundTokenHash: string | null;
}): ContactReachability {
  if (params.endpoint && params.outboundToken && params.inboundTokenHash) {
    return "bidirectional";
  }
  if (params.endpoint && params.outboundToken) return "outbound";
  return "inbound";
}

function isReachabilityStateValid(contact: AgentContact): boolean {
  if (contact.reachability !== "inbound" && (!contact.endpoint || !contact.outboundToken)) {
    return false;
  }
  if (contact.reachability !== "outbound" && !contact.inboundTokenHash) {
    return false;
  }
  return true;
}

function normalizeStoredContact(input: unknown): AgentContact | null {
  const item = input as Partial<AgentContact> | null;
  if (!item || typeof item.id !== "string" || typeof item.name !== "string") {
    return null;
  }

  const endpoint = normalizeOptionalEndpoint(item.endpoint);
  const outboundToken = normalizeOptionalToken(item.outboundToken);
  const inboundTokenHash = normalizeOptionalToken(item.inboundTokenHash);
  if (endpoint === undefined || outboundToken === undefined || inboundTokenHash === undefined) {
    return null;
  }

  const contact: AgentContact = {
    id: item.id,
    name: item.name.trim(),
    endpoint,
    reachability: isReachability(item.reachability)
      ? item.reachability
      : inferStoredReachability({
          endpoint,
          outboundToken,
          inboundTokenHash,
        }),
    status: isContactStatus(item.status) ? item.status : "trusted",
    outboundToken,
    inboundTokenHash,
    created_at: normalizeOptionalTimestamp(item.created_at) ?? 0,
    ...(normalizeOptionalTimestamp(item.lastSeenAt) !== undefined
      ? { lastSeenAt: normalizeOptionalTimestamp(item.lastSeenAt) }
      : {}),
  };

  if (!contact.name || !isReachabilityStateValid(contact)) return null;
  return contact;
}

function resolveReachability(contact: AgentContact): ContactReachability {
  if (contact.reachability) return contact.reachability;
  if (contact.endpoint && contact.outboundToken && contact.inboundTokenHash) {
    return "bidirectional";
  }
  if (contact.endpoint && contact.outboundToken) return "outbound";
  return "inbound";
}

/**
 * 创建 contact id。
 */
export function createStableContactId(name: string): string {
  return `contact_${toContactSlug(name)}`;
}

/**
 * 归一化 endpoint。
 */
export function normalizeContactEndpoint(endpoint: string): string {
  return normalizeEndpoint(endpoint);
}

/**
 * 保存 contact。
 */
export async function saveContact(
  data_path: string,
  contact: AgentContact,
): Promise<AgentContact> {
  const normalized: AgentContact = {
    ...contact,
    id: contact.id || createStableContactId(contact.name),
    name: String(contact.name || "").trim(),
    endpoint: contact.endpoint ? normalizeEndpoint(contact.endpoint) : null,
    reachability: resolveReachability(contact),
    status: contact.status || "trusted",
    outboundToken: contact.outboundToken || null,
    inboundTokenHash: contact.inboundTokenHash || null,
    created_at: contact.created_at || Date.now(),
  };
  if (!normalized.name) throw new Error("contact name is required");
  if (normalized.reachability !== "inbound" && !normalized.endpoint) {
    throw new Error("contact endpoint is required for outbound contacts");
  }
  if (normalized.reachability !== "inbound" && !normalized.outboundToken) {
    throw new Error("contact approve response did not include the peer token; generate a fresh link and approve again");
  }
  if (normalized.reachability !== "outbound" && !normalized.inboundTokenHash) {
    throw new Error("contact inbound token hash is required for inbound contacts");
  }
  await fs.ensureDir(getContactDirectoryPath(data_path, normalized.id));
  await fs.writeJson(getContactJsonPath(data_path, normalized.id), normalized, {
    spaces: 2,
  });
  await fs.ensureFile(getContactMessagesPath(data_path, normalized.id));
  return normalized;
}

/**
 * 读取 contact。
 */
export async function readContact(
  data_path: string,
  contactId: string,
): Promise<AgentContact | null> {
  const filePath = getContactJsonPath(data_path, contactId);
  if (!(await fs.pathExists(filePath))) return null;
  const raw = await fs.readJson(filePath).catch(() => null);
  // 关键点（中文）：读取时归一化可恢复字段，避免一次局部写入让已收到的 contact 在列表中消失。
  return normalizeStoredContact(raw);
}

/**
 * 列出全部 contact。
 */
export async function listContacts(data_path: string): Promise<AgentContact[]> {
  const root = getContactsRootPath(data_path);
  if (!(await fs.pathExists(root))) return [];
  const entries = await fs.readdir(root, { withFileTypes: true });
  const contacts: AgentContact[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const contact = await readContact(data_path, entry.name);
    if (contact) contacts.push(contact);
  }
  return contacts.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * 按 id/name 查找 contact。
 */
export async function findContact(
  data_path: string,
  query: string,
): Promise<AgentContact | null> {
  const value = String(query || "").trim();
  if (!value) return null;
  const contacts = await listContacts(data_path);
  const lower = value.toLowerCase();
  return (
    contacts.find((item) => item.id.toLowerCase() === lower) ||
    contacts.find((item) => item.name.toLowerCase() === lower) ||
    contacts.find((item) => item.name.toLowerCase().includes(lower)) ||
    null
  );
}

/**
 * 根据入站 token 查找 contact。
 */
export async function findContactByInboundToken(
  data_path: string,
  token: string,
): Promise<AgentContact | null> {
  const token_hash = hashContactToken(token);
  const contacts = await listContacts(data_path);
  return contacts.find((item) => item.inboundTokenHash === token_hash) || null;
}

/**
 * 更新 contact 最近在线时间。
 */
export async function touchContactSeen(
  data_path: string,
  contactId: string,
  seenAt: number = Date.now(),
): Promise<AgentContact | null> {
  const contact = await readContact(data_path, contactId);
  if (!contact) return null;
  return await saveContact(data_path, {
    ...contact,
    lastSeenAt: seenAt,
  });
}

/**
 * 追加 contact chat 消息。
 */
export async function appendContactMessage(
  data_path: string,
  contactId: string,
  message: ContactChatMessage,
): Promise<void> {
  const filePath = getContactMessagesPath(data_path, contactId);
  await fs.ensureDir(path.dirname(filePath));
  await fs.appendFile(filePath, `${JSON.stringify(message)}\n`, "utf-8");
}

/**
 * 读取 contact chat 历史。
 */
export async function readContactMessages(
  data_path: string,
  contactId: string,
): Promise<ContactChatMessage[]> {
  const filePath = getContactMessagesPath(data_path, contactId);
  if (!(await fs.pathExists(filePath))) return [];
  const text = await fs.readFile(filePath, "utf-8");
  const out: ContactChatMessage[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as ContactChatMessage;
      if (
        (parsed.role === "local" || parsed.role === "remote") &&
        typeof parsed.text === "string"
      ) {
        out.push(parsed);
      }
    } catch {
      // 忽略损坏的历史行，避免单条坏数据阻断整个 contact。
    }
  }
  return out;
}
