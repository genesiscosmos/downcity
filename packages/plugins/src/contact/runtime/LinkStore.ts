/**
 * contact link 本地状态存储。
 *
 * 关键点（中文）
 * - link code 明文只展示给用户；本地落盘只保存 secret hash。
 * - approve 成功后写入 usedAt 和恢复元数据，确保一次性语义并支持同一 agent 幂等重试。
 */

import fs from "fs-extra";
import type { ContactLinkRecord } from "@/contact/types/ContactLink.js";
import { getContactLinkPath, getContactLinksRootPath } from "./Paths.js";

function isLinkRecord(input: unknown): input is ContactLinkRecord {
  const item = input as Partial<ContactLinkRecord> | null;
  return Boolean(
    item &&
      typeof item.id === "string" &&
      typeof item.agentName === "string" &&
      typeof item.endpoint === "string" &&
      typeof item.secretHash === "string" &&
      typeof item.created_at === "number" &&
      typeof item.expires_at === "number",
  );
}

/**
 * 保存 link 记录。
 */
export async function saveContactLinkRecord(
  project_root: string,
  record: ContactLinkRecord,
): Promise<void> {
  await fs.ensureDir(getContactLinksRootPath(project_root));
  await fs.writeJson(getContactLinkPath(project_root, record.id), record, {
    spaces: 2,
  });
}

/**
 * 读取 link 记录。
 */
export async function readContactLinkRecord(
  project_root: string,
  linkId: string,
): Promise<ContactLinkRecord | null> {
  const filePath = getContactLinkPath(project_root, linkId);
  if (!(await fs.pathExists(filePath))) return null;
  const raw = await fs.readJson(filePath).catch(() => null);
  return isLinkRecord(raw) ? raw : null;
}
